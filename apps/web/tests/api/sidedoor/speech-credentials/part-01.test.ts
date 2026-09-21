// @vitest-environment node
import type { PrismaClient } from '@/generated/prisma/client';
import { captureLocalUsageAccount, captureUsageAccount } from '@/lib/agent-usage/account';
import {
  getCartesiaUsageProvider,
  resetCartesiaUsageCacheForTests,
} from '@/lib/agent-usage/providers/cartesia';
import {
  getClaudeUsageProvider,
  resetClaudeUsageCacheForTests,
} from '@/lib/agent-usage/providers/claude-code';
import {
  getElevenLabsUsageProvider,
  resetElevenLabsUsageCacheForTests,
} from '@/lib/agent-usage/providers/elevenlabs';
import { captureSottoCredentialProbe } from '@/lib/providers/shared/credential-validation';
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
import { captureSottoProviderAdmission } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { setSiteConfig } from '@/lib/site-config';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
  beforeAll(async () => {
    instance = await createSharedTestInstance('speech_credentials');
    boundary.database = instance.database;
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

  it('generates sound effects with the captured personal key and refuses revoked callers', async () => {
    await seed('enabled', 'elevenlabs');
    const audio = await readFile(
      new URL('../../../../src/assets/sfx/intro-warm.mp3', import.meta.url)
    );
    const sent: Request[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(new Request(input, init));
      return new Response(audio);
    });
    const provider = await createTtsProviderAsync('elevenlabs', await execution('elevenlabs'));
    if (!provider.generateSoundEffect) throw new Error('Expected sound effect support');
    expect(
      await provider.generateSoundEffect({ prompt: 'Ocean waves', durationSeconds: 8 })
    ).toEqual(audio);
    expect(sent.map((request) => [request.url, request.headers.get('xi-api-key')])).toEqual([
      ['https://api.elevenlabs.io/v1/sound-generation', 'personal-key'],
    ]);
    expect(await sent[0].json()).toEqual({ text: 'Ocean waves', duration_seconds: 8 });
    await identity.access.logout(identity.ownerToken);
    await expect(provider.generateSoundEffect({ prompt: 'Ocean waves' })).rejects.toMatchObject({
      code: 'unauthorized',
    });
    expect(sent).toHaveLength(1);
  });

  it('does not dispatch a cancelled sound effect request', async () => {
    await seed('enabled', 'elevenlabs');
    const provider = await createTtsProviderAsync('elevenlabs', await execution('elevenlabs'));
    const controller = new AbortController();
    const reason = new Error('Sound effect cancelled');
    controller.abort(reason);
    vi.stubGlobal('fetch', () => {
      throw new Error('Cancelled sound effect reached the provider');
    });
    if (!provider.generateSoundEffect) throw new Error('Expected sound effect support');
    await expect(
      provider.generateSoundEffect({ prompt: 'Ocean waves', signal: controller.signal })
    ).rejects.toBe(reason);
  });

  it('revalidates metadata admission without consuming credentials and refuses revoked callers', async () => {
    await seed();
    const captured = await execution();
    const admit = await captureSottoProviderAdmission(captured);
    await admit.validate(new AbortController().signal);
    const current = await execution();
    expect(current.credential?.selected).toEqual(captured.credential?.selected);
    await identity.access.logout(identity.ownerToken);
    await expect(admit.validate(new AbortController().signal)).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('uses saved usage credentials, isolates cached DTOs, and refuses revoked cache readers', async () => {
    await seed('enabled', 'elevenlabs');
    const captured = await execution('elevenlabs');
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Request(input, init).headers.get('xi-api-key')).toBe('personal-key');
      return Response.json({ character_count: 25, character_limit: 100, tier: 'creator' });
    });
    const first = await getElevenLabsUsageProvider(captured);
    expect(first?.status).toBe('ready');
    const usageTime = async () =>
      sottoTransaction(instance.database, async (tx) => {
        const storage = await sottoCredentialStorage(tx, 'tts', 'elevenlabs');
        const owner = await captureSottoCredentialOwner(tx, identity.ownerId);
        return (await storage.owned.head({ ...storage.slot, owner })).credential?.metadata
          .lastUsedAt;
      });
    const recorded = await usageTime();
    expect(recorded).toEqual(expect.any(Number));
    first!.windows[0]!.usedPercent = 99;
    vi.stubGlobal('fetch', async () => {
      throw new Error('Cache should satisfy this request');
    });
    expect((await getElevenLabsUsageProvider(captured))?.windows[0]?.usedPercent).toBe(25);
    expect(await usageTime()).toBe(recorded);
    await identity.access.logout(identity.ownerToken);
    await expect(getElevenLabsUsageProvider(captured)).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('refuses usage publication when the original caller is revoked during HTTP', async () => {
    await seed('enabled', 'elevenlabs');
    const captured = await execution('elevenlabs');
    vi.stubGlobal('fetch', async () => {
      await identity.access.logout(identity.ownerToken);
      return Response.json({ character_count: 25, character_limit: 100 });
    });
    await expect(getElevenLabsUsageProvider(captured)).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('checks cancellation on every metadata admission', async () => {
    const admit = await captureSottoProviderAdmission(await execution());
    const controller = new AbortController();
    const failure = new Error('Usage cancelled');
    controller.abort(failure);
    await expect(admit.validate(controller.signal)).rejects.toBe(failure);
  });

  it('uses the complete saved Cartesia account and refuses revoked cache readers', async () => {
    await seed('enabled', 'cartesia', { adminApiKey: 'personal-admin', monthlyCreditLimit: 10000 });
    const captured = await execution('cartesia');
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const outgoing = new Request(input, init);
      expect(outgoing.headers.get('authorization')).toBe('Bearer personal-admin');
      expect(new URL(outgoing.url).pathname).toBe('/usage/credits');
      return Response.json({ data: [{ credits: 1200 }] });
    });
    expect(await getCartesiaUsageProvider(captured)).toMatchObject({
      status: 'ready',
      credits: { label: '8,800 credits left' },
    });
    await identity.access.logout(identity.ownerToken);
    await expect(getCartesiaUsageProvider(captured)).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('uses one saved Cartesia account for generation, administration, and allowance settings', async () => {
    await seed('enabled', 'cartesia', {
      apiKey: 'saved-generation',
      adminApiKey: 'saved-admin',
      usagePlan: 'free',
    });
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Request(input, init).headers.get('authorization')).toBe('Bearer saved-admin');
      return Response.json({ data: [{ credits: 518 }] });
    });
    expect(await getCartesiaUsageProvider(await execution('cartesia'))).toMatchObject({
      planLabel: 'Free',
      status: 'ready',
      credits: { label: '19,482 credits left' },
    });
  });

  it('requires the Cartesia admin key in the same saved account', async () => {
    await seed('enabled', 'cartesia');
    vi.stubGlobal('fetch', async () => {
      throw new Error('No complete usage account');
    });
    expect(await getCartesiaUsageProvider(await execution('cartesia'))).toMatchObject({
      status: 'action_required',
    });
  });

  it.each(['elevenlabs', 'cartesia'] as const)(
    'refuses disabled %s credentials',
    async (provider) => {
      const captured = await execution(provider);
      await seed('disabled', provider);
      let reachedProvider = false;
      vi.stubGlobal('fetch', async () => {
        reachedProvider = true;
        return Response.json({});
      });
      const query =
        provider === 'elevenlabs' ? getElevenLabsUsageProvider : getCartesiaUsageProvider;
      await expect(query(captured)).rejects.toThrow();
      expect(reachedProvider).toBe(false);
    }
  );

  it('invalidates Cartesia cached usage when its saved account is replaced', async () => {
    await seed('enabled', 'cartesia', { adminApiKey: 'first-admin', monthlyCreditLimit: 10000 });
    const captured = await execution('cartesia');
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const key = new Request(input, init).headers.get('authorization');
      if (key === 'Bearer first-admin') return Response.json({ data: [{ credits: 1200 }] });
      if (key === 'Bearer second-admin') return Response.json({ data: [{ credits: 9000 }] });
      throw new Error('Unexpected account');
    });
    expect(await getCartesiaUsageProvider(captured)).toMatchObject({
      credits: { label: '8,800 credits left' },
    });
    await seed('enabled', 'cartesia', { adminApiKey: 'second-admin', monthlyCreditLimit: 20000 });
    expect(await getCartesiaUsageProvider(captured)).toMatchObject({
      credits: { label: '11,000 credits left' },
    });
  });

  it.each(['elevenlabs', 'cartesia'] as const)(
    'preserves %s cleanup failures when the caller also cancels',
    async (provider) => {
      await seed(
        'enabled',
        provider,
        provider === 'cartesia' ? { adminApiKey: 'saved-admin' } : {}
      );
      const controller = new AbortController();
      const cancellation = new Error('Caller cancelled');
      const cleanup = new Error('Response cleanup failed');
      const failure = new AggregateError([cancellation, cleanup], 'Request and cleanup failed', {
        cause: cleanup,
      });
      vi.stubGlobal(
        'fetch',
        async () =>
          new Response(
            new ReadableStream(
              {
                pull(stream) {
                  controller.abort(cancellation);
                  stream.error(failure);
                },
              },
              { highWaterMark: 0 }
            )
          )
      );
      const captured = { ...(await execution(provider)), signal: controller.signal };
      const query =
        provider === 'elevenlabs' ? getElevenLabsUsageProvider : getCartesiaUsageProvider;
      await expect(query(captured)).rejects.toBe(failure);
    }
  );

  it('canonicalizes field ordering while isolating captured account fields', async () => {
    await seed('enabled', 'cartesia', {
      apiKey: 'fixture',
      adminApiKey: 'admin',
      monthlyCreditLimit: 1000,
    });
    const captured = await execution('cartesia');
    const first = await captureUsageAccount(captured, 'cartesia');
    const second = await captureUsageAccount(captured, 'cartesia');
    expect(first.fingerprint()).toBe(second.fingerprint());
    expect(first.fields?.extraData?.adminApiKey).toBe('admin');
    expect(Object.isFrozen(first.fields?.extraData)).toBe(true);
    expect(first.fingerprint(['one-window'])).not.toBe(second.fingerprint(['another-window']));
  });

  it('revalidates local account admission after credential reads and partitions probe configuration', async () => {
    const captured = await execution();
    const account = await captureLocalUsageAccount(captured, 'claude-code', async () => ({
      accessToken: 'synthetic',
    }));
    expect(account.fingerprint(['model-one'])).not.toBe(account.fingerprint(['model-two']));
    await expect(
      captureLocalUsageAccount(captured, 'claude-code', async () => {
        await identity.access.logout(identity.ownerToken);
        return { accessToken: 'synthetic' };
      })
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('uses admitted Claude OAuth requests and refuses revoked cached results', async () => {
    vi.stubEnv(
      'CLAUDE_CODE_CREDENTIALS_JSON',
      JSON.stringify({ claudeAiOauth: { accessToken: 'synthetic-oauth', subscriptionType: 'pro' } })
    );
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const outgoing = new Request(input, init);
      expect(outgoing.headers.get('authorization')).toBe('Bearer synthetic-oauth');
      expect(outgoing.method).toBe('POST');
      return new Response(null, {
        headers: { 'anthropic-ratelimit-unified-5h-utilization': '0.25' },
      });
    });
    const captured = await execution();
    expect(await getClaudeUsageProvider(captured)).toMatchObject({
      status: 'ready',
      windows: [{ usedPercent: 25 }, { usedPercent: 0 }],
    });
    await identity.access.logout(identity.ownerToken);
    await expect(getClaudeUsageProvider(captured)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('keeps admission identity detached and transport rules bound to the original destination', async () => {
    await seed();
    const admission = await captureSottoProviderAdmission(await execution());
    const original = admission.identity;
    admission.identity.recipient.generation += 1;
    expect(admission.identity).toEqual(original);
    const rules = [{ method: 'GET', url: 'https://api.play.ht/api/v2/voices' }];
    vi.stubGlobal('fetch', async () => new Response('accepted'));
    const transport = admission.createTransport(rules);
    rules[0]!.url = 'https://unrelated.invalid/';
    const response = await transport.authenticatedFetch('https://api.play.ht/api/v2/voices');
    expect(await response.text()).toBe('accepted');
    await expect(transport.authenticatedFetch('https://unrelated.invalid/')).rejects.toThrow();
  });

  it('retains original cancellation when validation supplies a fresh signal', async () => {
    const controller = new AbortController();
    const admission = await captureSottoProviderAdmission({
      ...(await execution()),
      signal: controller.signal,
    });
    const failure = new Error('Original request cancelled');
    controller.abort(failure);
    await expect(admission.validate(new AbortController().signal)).rejects.toBe(failure);
    const transport = admission.createTransport([
      { method: 'GET', url: 'https://api.play.ht/api/v2/voices' },
    ]);
    await expect(transport.authenticatedFetch('https://api.play.ht/api/v2/voices')).rejects.toBe(
      failure
    );
  });

  it('refuses transport dispatch when authority was revoked after handle capture', async () => {
    await seed();
    const admission = await captureSottoProviderAdmission(await execution());
    await identity.access.logout(identity.ownerToken);
    const transport = admission.createTransport([
      { method: 'GET', url: 'https://api.play.ht/api/v2/voices' },
    ]);
    await expect(
      transport.authenticatedFetch('https://api.play.ht/api/v2/voices')
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it.each(['local', 'kokoro'] as const)(
    'keeps the captured %s sidecar endpoint and proxy key and rejects a revoked caller',
    async (providerId) => {
      await setSiteConfig(
        {
          ttsBaseUrl: 'http://192.168.1.10:8000/custom/prefix/',
          ttsVoices: 'captured-host,captured-expert',
        },
        identity.ownerId
      );
      invalidateServerInfra();
      const sent: Request[] = [];
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        sent.push(new Request(input, init));
        return new Response(new Uint8Array([1, 2, 3]));
      });
      const captured = await execution('openai');
      const provider = await createTtsProviderAsync(
        providerId,
        {
          ...captured,
          authorize: async (database) => {
            const admitted = await captured.authorize(database);
            await setSiteConfig(
              {
                ttsBaseUrl: 'http://replacement:9000',
                ttsVoices: 'replacement-host,replacement-expert',
              },
              identity.ownerId
            );
            invalidateServerInfra();
            return admitted;
          },
        },
        'captured-proxy-key',
        undefined,
        'chosen-model'
      );
      if (providerId === 'local') expect(provider.getVoiceId('HOST')).toBe('captured-host');
      expect(
        await provider.generateSpeech({
          text: 'Hola',
          voiceId: 'chosen-voice',
          language: 'es',
          modelId: 'per-call-model',
        })
      ).toEqual(Buffer.from([1, 2, 3]));
      expect(provider.getModelId()).toBe('chosen-model');
      expect(sent[0]!.url).toBe('http://192.168.1.10:8000/custom/prefix/tts');
      expect(sent[0]!.headers.get('authorization')).toBe('Bearer captured-proxy-key');
      expect(await sent[0]!.json()).toEqual({
        text: 'Hola',
        voice: 'chosen-voice',
        language: 'es',
        ...(providerId === 'local' ? { model: 'per-call-model' } : {}),
      });
      await identity.access.logout(identity.ownerToken);
      await expect(
        provider.generateSpeech({ text: 'Revoked', voiceId: 'chosen-voice' })
      ).rejects.toThrow();
      expect(sent).toHaveLength(1);
    }
  );

  it.each(['local', 'kokoro'] as const)(
    'preserves keyless %s operation and its existing model selection',
    async (providerId) => {
      await setSiteConfig({ ttsBaseUrl: 'http://local-tts:8000' }, identity.ownerId);
      invalidateServerInfra();
      let sent: Request | undefined;
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        sent = new Request(input, init);
        return new Response(new Uint8Array([1]));
      });
      const provider = await createTtsProviderAsync(
        providerId,
        await execution('openai'),
        undefined,
        undefined,
        'saved-local-model'
      );
      expect(provider.getModelId()).toBe(
        providerId === 'local' ? 'saved-local-model' : 'saved-local-model'
      );
      await provider.generateSpeech({ text: 'Hello', voiceId: 'default' });
      expect(sent!.headers.get('authorization')).toBeNull();
      expect(await sent!.json()).toEqual({
        text: 'Hello',
        voice: 'default',
        ...(providerId === 'local' ? { model: 'saved-local-model' } : {}),
      });
    }
  );

  it.each(['local', 'kokoro'] as const)(
    'propagates %s cancellation without wrapping it as a connectivity failure',
    async (providerId) => {
      await setSiteConfig({ ttsBaseUrl: 'http://local-tts:8000' }, identity.ownerId);
      invalidateServerInfra();
      const controller = new AbortController();
      const reason = new Error('Caller cancelled local speech');
      const captured = await execution('openai');
      const provider = await createTtsProviderAsync(providerId, {
        ...captured,
        signal: controller.signal,
      });
      controller.abort(reason);
      vi.stubGlobal('fetch', () => {
        throw new Error('Cancelled speech reached the sidecar');
      });
      await expect(provider.generateSpeech({ text: 'Hello', voiceId: 'default' })).rejects.toBe(
        reason
      );
    }
  );

  it.each(['local', 'kokoro'] as const)('loads the configured %s endpoint', async (providerId) => {
    await setSiteConfig({ ttsBaseUrl: 'http://configured-sidecar:8000/prefix' }, identity.ownerId);
    invalidateServerInfra();
    let destination: string | undefined;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      destination = new Request(input, init).url;
      return new Response(new Uint8Array([1]));
    });
    const provider = await createTtsProviderAsync(providerId, await execution('openai'));
    await provider.generateSpeech({ text: 'Hello', voiceId: 'default' });
    expect(destination).toBe('http://configured-sidecar:8000/prefix/tts');
  });
});
