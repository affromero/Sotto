// @vitest-environment node
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { useProviderCredentialDatabase } from '../../helpers/runtime/provider-credentials-postgres';
import { sidedoorStateStore } from '@/lib/sidedoor/access/state/store';
import { EMPTY_INFRA, getSiteConfig } from '@/lib/site-config';
import { createTtsProviderAsync } from '@/lib/providers/tts';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import type { LocalTtsConnection } from '@/lib/providers/shared/local-tts-connection';
import {
  captureSottoCredentialOwner,
  sottoCredentialStorage,
} from '@/lib/sidedoor/credentials/runtime/provider-credentials';
import { captureConfiguredSottoCredentialProbe } from '@/lib/providers/shared/credential-validation';
import { captureSottoExecutionCredential } from '@/lib/sidedoor/credentials/runtime/credential-execution';
import { closeRedis } from '@/lib/redis';

vi.hoisted(() => {
  const configured = process.env.SIDEDOOR_TEST_REDIS_URL;
  if (!configured) return;
  const url = new URL(configured);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/15')
    throw new Error('Use isolated local Redis 15');
  vi.stubEnv('REDIS_URL', configured);
});

let database: PrismaClient;
vi.mock('@/lib/prisma', () => ({
  get prismaUnfiltered() {
    return database;
  },
}));
vi.mock('openai', async () => {
  const { createRequire } = await import('node:module');
  return { default: createRequire(import.meta.url)('openai') };
});

const redisUrl = process.env.SIDEDOOR_TEST_REDIS_URL;
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL && redisUrl ? describe : describe.skip;
suite('owner-only draft speech discovery and audio without saving', () => {
  const fixture = useProviderCredentialDatabase();
  const endpoint = `http://local-${randomUUID()}.test:8000`;
  const rateKeys = ['discover', 'preview'].map(
    (action) => `ratelimit:local-speech-${action}:alice`
  );
  let redis: Redis;
  let discover: (request: Request) => Promise<Response>;
  let preview: (request: Request) => Promise<Response>;
  let observed: Request[];
  const voices = [
    { id: 'de-thorsten-medium', label: 'German Thorsten', language: 'de' },
    { id: 'de-kerstin-low', label: 'German Kerstin', language: 'de' },
  ];
  const audio = Buffer.alloc(48);
  audio.write('RIFF', 0);
  audio.writeUInt32LE(40, 4);
  audio.write('WAVE', 8);

  beforeAll(async () => {
    database = fixture.database;
    redis = new Redis(redisUrl!, { maxRetriesPerRequest: 1 });
    vi.stubEnv('REDIS_URL', redisUrl!);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost');
    discover = (await import('@/app/api/v1/settings/local-speech/discover/route')).POST;
    preview = (await import('@/app/api/v1/settings/local-speech/preview/route')).POST;
  });
  beforeEach(async () => {
    observed = [];
    await redis.del(...rateKeys);
    await fixture.transaction(async (tx) => {
      await sidedoorStateStore(tx).transact((state) => {
        state.configuration.site = {
          ...EMPTY_INFRA,
          ttsProvider: 'cartesia',
          ttsBaseUrl: 'http://saved-local.test:8000',
          ttsVoices: 'saved-a,saved-b',
        };
        const owner = state.access.principals.find((principal) => principal.role === 'owner');
        const profile = state.access.householdProfiles?.find((entry) => entry.id === 'alice');
        if (!owner || !profile) throw new Error('Missing fixture owner');
        profile.ownerPrincipalId = owner.id;
      });
      await tx.user.update({
        where: { id: 'alice' },
        data: { preferredTtsProvider: 'disabled', preferredTtsModel: null },
        select: { id: true },
      });
      const storage = await sottoCredentialStorage(tx, 'tts', 'cartesia');
      const owner = await captureSottoCredentialOwner(tx, 'alice');
      const values = { apiKey: `saved-cloud-fixture-${randomUUID()}` };
      const probe = await captureConfiguredSottoCredentialProbe(tx, 'tts', 'cartesia', values);
      if (probe.kind === 'unsupported') throw new Error('Missing fixture provider');
      await storage.owned.replace(
        storage.owned.prepareReplacement(
          { ...storage.slot, owner },
          {
            expectedHeadRevision: null,
            credentialRevision: randomUUID(),
            values,
            binding: probe.binding,
            availability: 'enabled',
            label: 'Preserved cloud speech',
            metadata: { createdAt: 1, updatedAt: 1, lastUsedAt: null },
          }
        )
      );
    });
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      observed.push(request);
      if (request.url === `${endpoint}/health`)
        return Response.json({ status: 'ok', engine: 'piper' });
      if (request.url === `${endpoint}/voices`) return Response.json({ voices });
      if (request.url === `${endpoint}/tts`) return new Response(audio);
      throw new Error('Unexpected network destination');
    });
  });
  afterEach(async () => {
    await redis.del(...rateKeys);
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await closeRedis();
    if (redis) await redis.quit();
  });

  async function request(
    action: 'discover' | 'preview',
    body: unknown,
    origin = 'http://localhost'
  ) {
    const admission = await fixture.transaction((tx) => fixture.admission(tx));
    return new NextRequest(`http://localhost/api/v1/settings/local-speech/${action}`, {
      method: 'POST',
      headers: {
        origin,
        cookie: admission.request.headers.get('cookie')!,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }
  async function state() {
    return fixture.transaction(async (tx) => ({
      shared: await sidedoorStateStore(tx).read(),
      site: await getSiteConfig({ database: tx }),
      profile: await tx.user.findUniqueOrThrow({
        where: { id: 'alice' },
        select: { preferredTtsProvider: true, preferredTtsModel: true },
      }),
      cloud: await (
        await sottoCredentialStorage(tx, 'tts', 'cartesia')
      ).owned.head({
        ...(await sottoCredentialStorage(tx, 'tts', 'cartesia')).slot,
        owner: await captureSottoCredentialOwner(tx, 'alice'),
      }),
    }));
  }
  const selection = {
    endpoint,
    model: 'local',
    voiceId: 'de-kerstin-low',
    language: 'de',
    text: 'Sotto. 1, 2, 3.',
  };

  it('discovers friendly German voices at the edited endpoint without selecting speech or changing shared settings', async () => {
    const incoming = await request('discover', { endpoint });
    const before = await state();
    const response = await discover(incoming);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      engine: 'piper',
      model: { id: 'local' },
      voices: voices.map(({ id, label, language }) => ({ id, name: label, language })),
    });
    expect(await state()).toEqual(before);
    expect(observed.map((outgoing) => outgoing.url)).toEqual([
      `${endpoint}/health`,
      `${endpoint}/voices`,
    ]);
    expect(
      observed.every(
        (outgoing) => outgoing.redirect === 'error' && !outgoing.headers.has('authorization')
      )
    ).toBe(true);
  });

  it('returns native WAV for the chosen model, voice and language without saving or using cloud speech', async () => {
    const incoming = await request('preview', selection);
    const before = await state();
    const response = await preview(incoming);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/wav');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(audio);
    expect(await observed[0]!.json()).toEqual({
      text: selection.text,
      model: selection.model,
      voice: selection.voiceId,
      language: 'de',
    });
    expect(observed[0]!.url).toBe(`${endpoint}/tts`);
    expect(observed[0]!.headers.has('authorization')).toBe(false);
    expect(await state()).toEqual(before);
  });

  it.each(['discover', 'preview'] as const)(
    'rejects unauthorized, non-owner and cross-origin %s without network access',
    async (action) => {
      const run = action === 'discover' ? discover : preview;
      const body = action === 'discover' ? { endpoint } : selection;
      const anonymous = new Request(`http://localhost/api/v1/settings/local-speech/${action}`, {
        method: 'POST',
        headers: { origin: 'http://localhost', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect((await run(anonymous)).status).toBe(401);
      expect((await run(await request(action, body, 'https://attacker.test'))).status).toBe(403);
      const incoming = await request(action, body);
      await fixture.transaction((tx) =>
        sidedoorStateStore(tx).transact((shared) => {
          const owner = shared.access.principals.find((principal) => principal.role === 'owner');
          if (!owner) throw new Error('Missing owner');
          owner.role = 'member';
        })
      );
      expect((await run(incoming)).status).toBe(403);
      expect(observed).toEqual([]);
    }
  );

  it.each([
    'file:///tmp/speech',
    'http://secret@local.test',
    'http://local.test?key=secret',
    'http://local.test#fragment',
  ])('rejects unsafe draft endpoint %s without dispatch', async (invalid) => {
    expect((await discover(await request('discover', { endpoint: invalid }))).status).toBe(400);
    expect(
      (await preview(await request('preview', { ...selection, endpoint: invalid }))).status
    ).toBe(400);
    expect(observed).toEqual([]);
  });

  it.each([
    { voices: [] },
    { voices: [voices[0], voices[0]] },
    { voices: Array.from({ length: 129 }, (_, index) => ({ id: `voice-${index}` })) },
  ])('rejects unusable catalogs without substituting saved voices: %j', async (catalog) => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) =>
      new URL(input instanceof Request ? input.url : String(input)).pathname === '/health'
        ? Response.json({ status: 'ok' })
        : Response.json(catalog)
    );
    const response = await discover(await request('discover', { endpoint }));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/catalog/i) });
  });

  it.each([302, 503])(
    'reports HTTP %i without following another destination or changing saved settings',
    async (status) => {
      const destinations: string[] = [];
      vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
        destinations.push(input instanceof Request ? input.url : String(input));
        return new Response('private diagnostic', {
          status,
          headers: { location: 'http://other.test' },
        });
      });
      const incoming = await request('discover', { endpoint });
      const before = await state();
      const response = await discover(incoming);
      expect(response.status).toBe(502);
      expect(destinations).toEqual([`${endpoint}/health`]);
      expect(JSON.stringify(await response.json())).not.toContain('private diagnostic');
      expect(await state()).toEqual(before);
    }
  );

  it('rejects a successful non-audio response instead of presenting a working preview', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ status: 'ok' }));
    expect((await preview(await request('preview', selection))).status).toBe(502);
  });

  it('withholds returned audio when owner authority is revoked during synthesis', async () => {
    vi.stubGlobal('fetch', async () => {
      await fixture.transaction((tx) =>
        sidedoorStateStore(tx).transact((shared) => {
          const owner = shared.access.principals.find((principal) => principal.role === 'owner');
          if (!owner) throw new Error('Missing owner');
          owner.role = 'member';
        })
      );
      return new Response(audio);
    });
    expect((await preview(await request('preview', selection))).status).toBe(409);
  });

  it('captures the factory draft before awaiting authority and refuses credential or provider substitution', async () => {
    const admission = await fixture.transaction((tx) => fixture.admission(tx));
    const execution = sottoRequestExecution(admission.request, admission.identity);
    const connection: LocalTtsConnection = {
      endpoint: `${endpoint}/tts`,
      model: 'local',
      voices: [],
    };
    const constructing = createTtsProviderAsync(
      'local',
      execution,
      undefined,
      undefined,
      'local',
      connection
    );
    connection.endpoint = 'http://changed.test/tts';
    connection.model = 'changed-model';
    const speech = await constructing;
    expect(
      await speech.generateSpeech({ text: selection.text, voiceId: selection.voiceId })
    ).toEqual(audio);
    expect(observed[0]!.url).toBe(`${endpoint}/tts`);
    expect((await observed[0]!.json()).model).toBe('local');
    const draft = { ...connection, endpoint: `${endpoint}/tts`, model: 'local' };
    await expect(
      createTtsProviderAsync('kokoro', execution, undefined, undefined, 'local', draft)
    ).rejects.toThrow(/draft local/i);
    await expect(
      createTtsProviderAsync('local', execution, 'saved-key', undefined, 'local', draft)
    ).rejects.toThrow(/draft local/i);
    await expect(
      createTtsProviderAsync('local', execution, undefined, { saved: 'credential' }, 'local', draft)
    ).rejects.toThrow(/draft local/i);
    const credential = await fixture.transaction((tx) =>
      captureSottoExecutionCredential(tx, execution.authorize, 'tts', 'cartesia', true)
    );
    if (!credential) throw new Error('Missing fixture cloud credential');
    await expect(
      createTtsProviderAsync(
        'local',
        { ...execution, credential },
        undefined,
        undefined,
        'local',
        draft
      )
    ).rejects.toThrow(/draft local/i);
  });

  it('bounds discovery bytes instead of trusting an oversized catalog', async () => {
    let cancelled = false;
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(256 * 1024 + 1));
            },
            cancel() {
              cancelled = true;
            },
          })
        )
    );
    expect((await discover(await request('discover', { endpoint }))).status).toBe(502);
    expect(cancelled).toBe(true);
  });

  it('cancels a pending local response without exposing partial audio or saving the draft', async () => {
    const cancellation = new AbortController();
    let cancelled = false;
    vi.stubGlobal('fetch', async () => {
      cancellation.abort(new Error('Leave preview'));
      return new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        })
      );
    });
    const original = await request('preview', selection);
    const incoming = new Request(original, { signal: cancellation.signal });
    const before = await state();
    const response = await preview(incoming);
    expect(response.status).toBe(499);
    expect(cancelled).toBe(true);
    expect(await state()).toEqual(before);
  });

  it('limits repeated discovery attempts without dispatching another local request', async () => {
    const now = Date.now();
    for (let index = 0; index < 20; index++)
      await redis.zadd(rateKeys[0]!, now, `owned-rate-${index}`);
    expect((await discover(await request('discover', { endpoint }))).status).toBe(429);
    expect(observed).toEqual([]);
  });
});
