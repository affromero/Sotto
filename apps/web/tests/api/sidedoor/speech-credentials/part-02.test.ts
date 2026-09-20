// @vitest-environment node
import type { PrismaClient } from '@/generated/prisma/client';
import { resetCartesiaUsageCacheForTests } from '@/lib/agent-usage/providers/cartesia';
import { resetClaudeUsageCacheForTests } from '@/lib/agent-usage/providers/claude-code';
import { resetElevenLabsUsageCacheForTests } from '@/lib/agent-usage/providers/elevenlabs';
import { captureSottoCredentialProbe } from '@/lib/providers/shared/credential-validation';
import { CARTESIA_TTS_API_VERSION } from '@/lib/providers/shared/speech-contracts';
import { createTtsProviderAsync } from '@/lib/providers/tts';
import { invalidateServerInfra } from '@/lib/server-config';
import {
  requireOriginalSottoAdmission,
  resolveSottoRequest,
} from '@/lib/sidedoor/access/core/request-identity';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { captureSottoExecutionCredential } from '@/lib/sidedoor/credentials/runtime/credential-execution';
import {
  captureSottoCredentialOwner,
  sottoCredentialStorage,
} from '@/lib/sidedoor/credentials/runtime/provider-credentials';
import { createSottoMediaTransport } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSharedTestInstance,
  type SharedTestIdentity,
  type SharedTestInstance,
} from '../../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({
  database: null as PrismaClient | null,
  token: '',
  allowed: true,
  usageCache: new Map<string, unknown>(),
}));
vi.mock('openai', async () => {
  const { createRequire } = await import('node:module');
  return { default: createRequire(import.meta.url)('openai') };
});
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (boundary.token ? { value: boundary.token } : undefined) }),
}));
vi.mock('@/lib/redis', () => ({
  checkRateLimit: async () => ({ allowed: boundary.allowed, remaining: 1 }),
  cache: {
    get: async (key: string) => boundary.usageCache.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      boundary.usageCache.set(key, value);
    },
  },
}));
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;

suite('speech tooling uses complete canonical credentials', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let preview: typeof import('@/app/api/v1/voices/preview/route');
  let admin: typeof import('@/app/api/v1/admin/test-model/route');
  beforeAll(async () => {
    instance = await createSharedTestInstance('speech_credentials');
    boundary.database = instance.database;
    preview = await import('@/app/api/v1/voices/preview/route');
    admin = await import('@/app/api/v1/admin/test-model/route');
  });
  beforeEach(async () => {
    vi.stubEnv('BYOK_ENCRYPTION_KEY', '1'.repeat(64));
    identity = await instance.reset();
    boundary.token = identity.ownerToken;
    boundary.allowed = true;
    boundary.usageCache.clear();
    resetElevenLabsUsageCacheForTests();
    resetCartesiaUsageCacheForTests();
    resetClaudeUsageCacheForTests();
    invalidateServerInfra();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await instance?.close();
    boundary.database = null;
  });

  async function seed(
    availability: 'enabled' | 'disabled' = 'enabled',
    provider = 'playht',
    fields: Record<string, string | number> = {}
  ) {
    await sottoTransaction(instance.database, async (tx) => {
      const storage = await sottoCredentialStorage(tx, 'tts', provider);
      const owner = await captureSottoCredentialOwner(tx, identity.ownerId);
      const values: Record<string, string | number> = {
        ...(provider === 'playht'
          ? { apiKey: 'personal-key', userId: 'personal-account' }
          : { apiKey: 'personal-key' }),
        ...fields,
      };
      const probe = captureSottoCredentialProbe('tts', provider, values);
      if (probe.kind === 'unsupported')
        throw new Error('Fixture provider must support credentials');
      const head = await storage.owned.head({ ...storage.slot, owner });
      await storage.owned.replace(
        storage.owned.prepareReplacement(
          { ...storage.slot, owner },
          {
            expectedHeadRevision: head.revision,
            credentialRevision: randomUUID(),
            values,
            binding: probe.binding,
            availability,
            label: provider,
            metadata: { createdAt: 1, updatedAt: 1, lastUsedAt: null },
          }
        )
      );
    });
  }
  function request(kind: 'preview' | 'admin', body?: unknown) {
    return new NextRequest(
      `http://localhost/api/v1/${kind === 'preview' ? 'voices/preview' : 'admin/test-model'}`,
      {
        method: 'POST',
        headers: { cookie: `sotto_session=${boundary.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(
          body ??
            (kind === 'preview'
              ? { provider: 'playht', voiceId: 'voice', text: 'Hello' }
              : { type: 'tts', provider: 'playht', model: 'Play3.0-mini' })
        ),
      }
    );
  }
  async function execution(provider = 'playht') {
    const originalRequest = request('preview');
    const original = await sottoTransaction(instance.database, (tx) =>
      resolveSottoRequest(tx, originalRequest)
    );
    if (!original || original.kind !== 'content')
      throw new Error('Expected fixture content identity');
    const authorize = async (tx: Parameters<typeof requireOriginalSottoAdmission>[0]) => {
      await requireOriginalSottoAdmission(tx, originalRequest, original);
      return { userId: original.userId };
    };
    const credential = await sottoTransaction(instance.database, (tx) =>
      captureSottoExecutionCredential(tx, authorize, 'tts', provider, true)
    );
    return { userId: original.userId, authorize, credential, signal: originalRequest.signal };
  }

  it('checks saved media authority on redirects without recording provider usage', async () => {
    await seed();
    const captured = await execution();
    const sent: Request[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(new Request(input, init));
      if (sent.length === 1)
        return new Response(null, {
          status: 302,
          headers: { location: 'https://cdn.example/reference?signature=one' },
        });
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const media = await createSottoMediaTransport(captured, {
      maxBytes: 32,
      timeoutMs: 1_000,
      admitDestination: async (value) => {
        if (!['media.example', 'cdn.example'].includes(new URL(value).hostname))
          throw new Error('Unapproved media host');
      },
    });
    expect(await media.downloadMedia('https://media.example/reference')).toEqual(
      new Uint8Array([1, 2, 3])
    );
    expect(sent.map((request) => request.url)).toEqual([
      'https://media.example/reference',
      'https://cdn.example/reference?signature=one',
    ]);
    expect(sent.map((request) => [...request.headers])).toEqual([[], []]);
    await sottoTransaction(instance.database, async (tx) => {
      const storage = await sottoCredentialStorage(tx, 'tts', 'playht');
      const slot = { ...storage.slot, owner: captured.credential!.selected.credential.owner };
      const head = await storage.owned.head(slot);
      expect(head.credential?.metadata.lastUsedAt).toBeNull();
      await storage.owned.remove(slot, head.revision, randomUUID());
    });
    await expect(media.downloadMedia('https://media.example/reference')).rejects.toThrow();
    expect(sent.map((request) => request.url)).toEqual([
      'https://media.example/reference',
      'https://cdn.example/reference?signature=one',
    ]);
  });

  it('rejects media redirects after the original session is revoked', async () => {
    const sent: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      sent.push(new Request(input).url);
      await identity.access.logout(identity.ownerToken);
      return new Response(null, { status: 302, headers: { location: '/next' } });
    });
    const media = await createSottoMediaTransport(await execution(), {
      maxBytes: 32,
      timeoutMs: 1_000,
      admitDestination: async (value) => {
        if (new URL(value).origin !== 'https://media.example')
          throw new Error('Unapproved media host');
      },
    });
    await expect(media.downloadMedia('https://media.example/reference')).rejects.toThrow();
    expect(sent).toEqual(['https://media.example/reference']);
  });

  it('uses the canonical OpenAI endpoint with the captured saved account', async () => {
    await seed('enabled', 'openai', { apiKey: 'captured-openai-key' });
    let sent: Request | undefined;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      sent = new Request(input, init);
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const provider = await createTtsProviderAsync('openai', await execution('openai'));
    expect(await provider.generateSpeech({ text: 'Hello', voiceId: 'alloy' })).toEqual(
      Buffer.from([1, 2, 3])
    );
    expect(sent?.url).toBe('https://api.openai.com/v1/audio/speech');
    expect(sent?.headers.get('authorization')).toBe('Bearer captured-openai-key');
  });

  it('sends the captured account even when separate factory arguments name another account', async () => {
    await seed();
    const captured = await execution();
    let sent: Request | undefined;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      sent = new Request(input, init);
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const provider = await createTtsProviderAsync('playht', captured, 'unrelated-key', {
      userId: 'unrelated-account',
    });
    await provider.generateSpeech({ text: 'Hello', voiceId: 'voice' });
    expect(sent?.headers.get('authorization')).toBe('personal-key');
    expect(sent?.headers.get('x-user-id')).toBe('personal-account');
  });

  it('preserves Deepgram voice and output settings with the captured account and rejects later revocation', async () => {
    await seed('enabled', 'deepgram', { apiKey: 'captured-deepgram-key' });
    const sent: Request[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(new Request(input, init));
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const provider = await createTtsProviderAsync('deepgram', await execution('deepgram'));
    expect(await provider.generateSpeech({ text: 'Hello', voiceId: 'aura-2-thalia-en' })).toEqual(
      Buffer.from([1, 2, 3])
    );
    expect(sent.map((item) => item.url)).toEqual([
      'https://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=mp3&bit_rate=48000',
    ]);
    expect(sent[0]!.headers.get('authorization')).toBe('Token captured-deepgram-key');
    expect(await sent[0]!.json()).toEqual({ text: 'Hello' });
    await identity.access.logout(identity.ownerToken);
    await expect(
      provider.generateSpeech({ text: 'Again', voiceId: 'aura-2-thalia-en' })
    ).rejects.toThrow();
    expect(sent.map((item) => item.url)).toEqual([
      'https://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=mp3&bit_rate=48000',
    ]);
  });

  it('rechecks the original session before an OpenAI SDK retry reaches HTTP', async () => {
    await seed('enabled', 'openai', { apiKey: 'saved-openai-key' });
    const sent: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(new Request(input, init).url);
      await identity.access.logout(identity.ownerToken);
      return Response.json({ error: { message: 'Temporarily unavailable' } }, { status: 503 });
    });
    const provider = await createTtsProviderAsync('openai', await execution('openai'));
    await expect(provider.generateSpeech({ text: 'Hello', voiceId: 'alloy' })).rejects.toThrow();
    expect(sent).toEqual(['https://api.openai.com/v1/audio/speech']);
  });

  it('preserves Rime language, voice, model and captured key while rejecting revoked access', async () => {
    const sent: Request[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(new Request(input, init));
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const provider = await createTtsProviderAsync(
      'rime',
      await execution('rime'),
      'captured-key',
      undefined,
      'arcana'
    );
    expect(
      await provider.generateSpeech({ text: 'Hola', voiceId: 'speaker', language: 'es' })
    ).toEqual(Buffer.from([1, 2, 3]));
    expect(sent[0]!.url).toBe('https://users.rime.ai/v1/rime-tts');
    expect(sent[0]!.headers.get('authorization')).toBe('Bearer captured-key');
    expect(sent[0]!.headers.get('accept')).toBe('audio/mpeg');
    expect(await sent[0]!.json()).toEqual({
      text: 'Hola',
      speaker: 'speaker',
      modelId: 'arcana',
      lang: 'es',
    });
    await identity.access.logout(identity.ownerToken);
    await expect(provider.generateSpeech({ text: 'Again', voiceId: 'speaker' })).rejects.toThrow();
    expect(sent.map((item) => item.url)).toEqual(['https://users.rime.ai/v1/rime-tts']);
  });

  it.each([
    ['deepgram', 200],
    ['deepgram', 503],
    ['rime', 200],
    ['rime', 503],
    ['cartesia', 200],
    ['cartesia', 503],
  ] as const)(
    'preserves cancellation while reading the %s response body with status %i',
    async (providerId, status) => {
      const failure = new DOMException('Response cancelled', 'AbortError');
      vi.stubGlobal(
        'fetch',
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(failure);
              },
            }),
            { status }
          )
      );
      const provider = await createTtsProviderAsync(
        providerId,
        await execution(providerId),
        'captured-key'
      );
      await expect(
        provider.generateSpeech({ text: 'Hello', voiceId: 'aura-2-thalia-en' })
      ).rejects.toBe(failure);
    }
  );

  it.each(['octave-v1', 'octave-v2'])(
    'preserves Hume %s continuity and word timings through admitted requests',
    async (model) => {
      const sent: Request[] = [];
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        sent.push(new Request(input, init));
        return Response.json({
          generations: [
            {
              audio: 'AQID',
              generation_id: 'next-generation',
              duration: 1,
              timestamps: [{ word: 'Hello', start: 0, end: 1 }],
            },
          ],
        });
      });
      const provider = await createTtsProviderAsync(
        'hume',
        await execution('hume'),
        'captured-hume-key',
        undefined,
        model
      );
      const params = { text: 'Hello', voiceId: 'speaker', continuityIds: ['previous-generation'] };
      expect(await provider.generateSpeech(params)).toEqual(Buffer.from([1, 2, 3]));
      expect(provider.getLastContinuityId?.()).toBe('next-generation');
      expect(await provider.generateSpeechWithTimestamps!(params)).toEqual({
        audio: Buffer.from([1, 2, 3]),
        wordTimings: [{ word: 'Hello', start: 0, end: 1 }],
      });
      for (const request of sent) {
        expect(request.url).toBe('https://api.hume.ai/v0/tts');
        expect(request.headers.get('x-hume-api-key')).toBe('captured-hume-key');
      }
      expect(await sent[1]!.json()).toMatchObject({
        version: model === 'octave-v1' ? '1' : '2',
        include_timestamp_types: ['word'],
        format: { type: 'mp3' },
        utterances: [
          {
            text: 'Hello',
            voice: { id: 'speaker' },
            previous_generation_id: 'previous-generation',
          },
        ],
      });
      await identity.access.logout(identity.ownerToken);
      await expect(provider.generateSpeechWithTimestamps!(params)).rejects.toThrow();
      expect(sent.map((item) => item.url)).toEqual([
        'https://api.hume.ai/v0/tts',
        'https://api.hume.ai/v0/tts',
      ]);
    }
  );

  it('preserves Cartesia language, version and output settings with the captured account', async () => {
    await seed('enabled', 'cartesia', { apiKey: 'captured-cartesia-key' });
    const sent: Request[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(new Request(input, init));
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const provider = await createTtsProviderAsync('cartesia', await execution('cartesia'));
    expect(
      await provider.generateSpeech({ text: 'Hola', voiceId: 'speaker', language: 'es' })
    ).toEqual(Buffer.from([1, 2, 3]));
    expect(sent[0]!.headers.get('x-api-key')).toBe('captured-cartesia-key');
    expect(sent[0]!.headers.get('cartesia-version')).toBe(CARTESIA_TTS_API_VERSION);
    expect(await sent[0]!.json()).toMatchObject({
      transcript: 'Hola',
      model_id: provider.getModelId(),
      voice: { mode: 'id', id: 'speaker' },
      language: 'es',
      output_format: { container: 'mp3', bit_rate: 192000, sample_rate: 44100 },
    });
    await identity.access.logout(identity.ownerToken);
    await expect(provider.generateSpeech({ text: 'Again', voiceId: 'speaker' })).rejects.toThrow();
    expect(sent.map((request) => request.url)).toEqual(['https://api.cartesia.ai/tts/bytes']);
  });

  it.each(['speech', 'timestamps'])(
    'keeps the captured ElevenLabs account for %s despite per-call substitutions',
    async (mode) => {
      await seed('enabled', 'elevenlabs', { apiKey: 'captured-elevenlabs-key' });
      let sent: Request | undefined;
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        sent = new Request(input, init);
        if (mode === 'timestamps')
          return Response.json(
            {
              audio_base64: 'AQID',
              alignment: {
                characters: ['H', 'i'],
                character_start_times_seconds: [0, 0.2],
                character_end_times_seconds: [0.2, 0.4],
              },
            },
            { headers: { 'request-id': 'captured-request' } }
          );
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'request-id': 'captured-request' },
        });
      });
      const provider = await createTtsProviderAsync(
        'elevenlabs',
        await execution('elevenlabs'),
        undefined,
        undefined,
        'eleven_v3'
      );
      expect(provider.getVoiceId('HOST', 'episode')).not.toBe(
        provider.getVoiceId('EXPERT', 'episode')
      );
      const params = {
        text: 'Hi',
        voiceId: 'speaker',
        apiKeyOverride: 'injected-key',
        previousText: 'Before',
        nextText: 'After',
        continuityIds: ['old-request'],
      };
      if (mode === 'timestamps')
        expect(await provider.generateSpeechWithTimestamps!(params)).toEqual({
          audio: Buffer.from([1, 2, 3]),
          wordTimings: [{ word: 'Hi', start: 0, end: 0.4 }],
        });
      else expect(await provider.generateSpeech(params)).toEqual(Buffer.from([1, 2, 3]));
      expect(sent?.headers.get('xi-api-key')).toBe('captured-elevenlabs-key');
      const body = await sent!.json();
      expect(body.model_id).toBe('eleven_v3');
      expect(body).not.toHaveProperty('previous_text');
      expect(body).not.toHaveProperty('next_text');
      expect(body).not.toHaveProperty('previous_request_ids');
      expect(provider.getLastContinuityId?.()).toBe('captured-request');
      await identity.access.logout(identity.ownerToken);
      await expect(provider.generateSpeech(params)).rejects.toThrow();
    }
  );

  it('uses the captured ElevenLabs account for subscription lookup and caches its limit', async () => {
    await seed('enabled', 'elevenlabs', { apiKey: 'captured-subscription-key' });
    const sent: Request[] = [];
    let bodyClosed = false;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(new Request(input, init));
      return new Response(
        new ReadableStream({
          cancel() {
            bodyClosed = true;
          },
        }),
        { headers: { 'maximum-concurrent-requests': '7' } }
      );
    });
    const provider = await createTtsProviderAsync('elevenlabs', await execution('elevenlabs'));
    expect(await provider.getConcurrencyLimit!()).toBe(7);
    expect(await provider.getConcurrencyLimit!()).toBe(7);
    expect(sent.map((request) => request.url)).toEqual([
      'https://api.elevenlabs.io/v1/user/subscription',
    ]);
    expect(sent[0]!.headers.get('xi-api-key')).toBe('captured-subscription-key');
    expect(bodyClosed).toBe(true);
    boundary.usageCache.clear();
    await identity.access.logout(identity.ownerToken);
    await expect(provider.getConcurrencyLimit!()).rejects.toThrow();
    expect(sent.map((request) => request.url)).toEqual([
      'https://api.elevenlabs.io/v1/user/subscription',
    ]);
  });

  it.each([
    { status: 200, limit: null, expected: 2 },
    { status: 200, limit: '2junk', expected: null },
    { status: 503, limit: null, expected: null },
  ])(
    'handles subscription status $status and limit $limit explicitly',
    async ({ status, limit, expected }) => {
      vi.stubGlobal(
        'fetch',
        async () =>
          new Response(null, {
            status,
            headers: limit ? { 'maximum-concurrent-requests': limit } : {},
          })
      );
      const provider = await createTtsProviderAsync(
        'elevenlabs',
        await execution('elevenlabs'),
        'selected-key'
      );
      if (expected === null) await expect(provider.getConcurrencyLimit!()).rejects.toThrow();
      else expect(await provider.getConcurrencyLimit!()).toBe(expected);
    }
  );

  it.each([
    ['hume', 'speech'],
    ['hume', 'timestamps'],
    ['elevenlabs', 'speech'],
    ['elevenlabs', 'timestamps'],
  ] as const)(
    'does not publish %s continuity after cancelled %s response parsing',
    async (providerId, mode) => {
      const failure = new DOMException('Response cancelled', 'AbortError');
      vi.stubGlobal(
        'fetch',
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(failure);
              },
            }),
            { headers: { 'content-type': 'application/json' } }
          )
      );
      const provider = await createTtsProviderAsync(
        providerId,
        await execution(providerId),
        'captured-key'
      );
      const params = { text: 'Hello', voiceId: 'speaker' };
      await expect(
        mode === 'speech'
          ? provider.generateSpeech(params)
          : provider.generateSpeechWithTimestamps!(params)
      ).rejects.toBe(failure);
      expect(provider.getLastContinuityId?.()).toBeNull();
    }
  );

  it('rejects a revoked request after provider construction without HTTP', async () => {
    await seed();
    const outgoing: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      outgoing.push(String(input));
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const provider = await createTtsProviderAsync('playht', await execution());
    await identity.access.logout(identity.ownerToken);
    await expect(provider.generateSpeech({ text: 'Hello', voiceId: 'voice' })).rejects.toThrow();
    expect(outgoing).toEqual([]);
  });

  it('rejects a removed credential after provider construction without recording use or sending HTTP', async () => {
    await seed();
    const captured = await execution();
    const outgoing: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      outgoing.push(String(input));
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const provider = await createTtsProviderAsync('playht', captured);
    await sottoTransaction(instance.database, async (tx) => {
      const storage = await sottoCredentialStorage(tx, 'tts', 'playht');
      const slot = { ...storage.slot, owner: captured.credential!.selected.credential.owner };
      const head = await storage.owned.head(slot);
      expect(head.credential?.metadata.lastUsedAt).toBeNull();
      await storage.owned.remove(slot, head.revision, randomUUID());
    });
    await expect(provider.generateSpeech({ text: 'Hello', voiceId: 'voice' })).rejects.toThrow();
    expect(outgoing).toEqual([]);
  });
  it.each(['preview', 'admin'] as const)('%s sends the complete saved account', async (kind) => {
    await seed();
    let observed: { key: string | null; account: string | null } | undefined;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, options?: RequestInit) => {
      const outgoing = new Request(input, options);
      expect(outgoing.url).toBe('https://api.play.ht/api/v2/tts/stream');
      if (kind === 'preview') {
        const usedAt = await sottoTransaction(instance.database, async (tx) => {
          const storage = await sottoCredentialStorage(tx, 'tts', 'playht');
          const owner = await captureSottoCredentialOwner(tx, identity.ownerId);
          return (await storage.owned.head({ ...storage.slot, owner })).credential?.metadata
            .lastUsedAt;
        });
        expect(usedAt).toEqual(expect.any(Number));
      }
      observed = {
        key: outgoing.headers.get('authorization'),
        account: outgoing.headers.get('x-user-id'),
      };
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const response = await (kind === 'preview' ? preview : admin).POST(request(kind));
    expect(response.status).toBe(200);
    if (kind === 'preview')
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    else expect(await response.json()).toMatchObject({ success: true });
    expect(observed).toEqual({ key: 'personal-key', account: 'personal-account' });
    if (kind === 'preview')
      expect(
        await instance.database.apiUsageLog.findFirst({
          where: { userId: identity.ownerId, category: 'voice_preview' },
        })
      ).toMatchObject({ service: 'playht', inputTokens: 5 });
  });
  it.each(['preview', 'admin'] as const)('%s refuses a disabled saved credential', async (kind) => {
    await seed('disabled');
    let transmitted = false;
    vi.stubGlobal('fetch', async () => {
      transmitted = true;
      throw new Error('Disabled key reached provider');
    });
    const response = await (kind === 'preview' ? preview : admin).POST(request(kind));
    if (kind === 'preview') expect(response.status).toBe(409);
    else expect(await response.json()).toMatchObject({ success: false });
    expect(transmitted).toBe(false);
  });
  it('rejects missing authentication, throttled previews and malformed input before provider access', async () => {
    boundary.token = '';
    expect((await preview.POST(request('preview'))).status).toBe(401);
    boundary.token = identity.ownerToken;
    boundary.allowed = false;
    expect((await preview.POST(request('preview'))).status).toBe(429);
    boundary.allowed = true;
    expect((await preview.POST(request('preview', {}))).status).toBe(400);
  });
});
