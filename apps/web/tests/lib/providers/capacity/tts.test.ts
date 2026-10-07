// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import Redis from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProviderTransport } from 'thesidedoor-core/providers/transport';
import { CartesiaProvider } from '@/lib/providers/tts/cartesia.provider';
import type { SpeechParams, TtsProvider } from '@/lib/providers/tts';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { decorateTtsProvider, TtsParentStoppedError } from '@/lib/providers/capacity/tts';

const cacheBoundary = vi.hoisted(() => ({
  client: null as Redis | null,
  keys: new Set<string>(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: {}, prismaUnfiltered: {} }));
vi.mock('@/lib/redis', () => ({
  cache: {
    async get(key: string) {
      cacheBoundary.keys.add(key);
      const value = await cacheBoundary.client!.get(key);
      return value === null ? null : JSON.parse(value);
    },
    async set(key: string, value: unknown, ttl: number) {
      cacheBoundary.keys.add(key);
      await cacheBoundary.client!.set(key, JSON.stringify(value), 'EX', ttl);
    },
  },
}));

const redisUrl = process.env.SIDEDOOR_TEST_REDIS_URL ?? process.env.REDIS_URL;

describe.skipIf(!redisUrl)('speech capacity owns complete provider requests', () => {
  let redis: Redis;
  const resources = new Set<string>();
  const calls: Array<Promise<unknown>> = [];
  const cancellations: AbortController[] = [];
  const responses = new Set<{ finishAll: () => void }>();

  beforeAll(async () => {
    redis = new Redis(redisUrl!, { maxRetriesPerRequest: 1 });
    cacheBoundary.client = redis;
    await redis.ping();
  });
  beforeEach(() => {
    vi.stubEnv('REDIS_URL', redisUrl!);
  });
  afterEach(async () => {
    vi.useRealTimers();
    for (const response of responses) response.finishAll();
    for (const controller of cancellations) controller.abort(new Error('Capacity test completed'));
    await Promise.allSettled(calls);
    for (const resource of resources) {
      await redis.del(semaphoreKey(resource));
    }
    resources.clear();
    calls.length = 0;
    cancellations.length = 0;
    responses.clear();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    for (const key of cacheBoundary.keys) await redis.del(key);
    cacheBoundary.keys.clear();
    cacheBoundary.client = null;
    await redis.quit();
  });

  function semaphoreKey(resource: string) {
    return `${SIDEDOOR_STATE_ID}:semaphore:v1:${Buffer.from(resource).toString('base64url')}`;
  }
  function resource() {
    const value = `test:speech-capacity:${randomUUID()}`;
    resources.add(value);
    return value;
  }
  function cancellation() {
    const controller = new AbortController();
    cancellations.push(controller);
    return controller;
  }
  function track<Result>(promise: Promise<Result>): Promise<Result> {
    calls.push(promise);
    void promise.catch(() => {});
    return promise;
  }
  async function sessions(capacityResource: string) {
    const name = `name=sotto-sidedoor-semaphore:${createHash('sha256')
      .update(capacityResource)
      .digest('hex')
      .slice(0, 12)}`;
    return String(await redis.client('LIST'))
      .split('\n')
      .filter((line) => line.split(' ').includes(name));
  }
  async function killSession(capacityResource: string) {
    const clients = await sessions(capacityResource);
    expect(clients).toHaveLength(1);
    const id = clients[0]!.match(/(?:^| )id=(\d+)/)?.[1];
    expect(id).toBeDefined();
    await redis.client('KILL', 'ID', id!);
    await expect.poll(async () => (await sessions(capacityResource)).length).toBe(0);
  }

  function cartesia(
    capacityResource: string,
    options: { signal?: AbortSignal; onCleanupError?: (error: unknown) => void } = {}
  ) {
    const sent: string[] = [];
    const pending = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
    let rejection: string | undefined;
    const transport = createProviderTransport({
      rules: [{ method: 'POST', url: CartesiaProvider.speechEndpoint }],
      signal: options.signal,
      admit: async () => {},
      implementation: async (input, init) => {
        const outgoing = new Request(input, init);
        const body = (await outgoing.json()) as { transcript: string };
        sent.push(body.transcript);
        if (rejection !== undefined) {
          const error = rejection;
          rejection = undefined;
          return new Response(error, { status: 429 });
        }
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([0x49, 0x44, 0x33]));
              pending.set(body.transcript, controller);
            },
            cancel() {
              pending.delete(body.transcript);
            },
          })
        );
      },
    });
    const bare = new CartesiaProvider(`capacity-fixture-${randomUUID()}`, transport);
    const provider = decorateTtsProvider(bare, { resource: capacityResource, ...options });
    const finish = (text: string) => {
      const body = pending.get(text);
      if (!body) throw new Error(`No pending response for ${text}`);
      pending.delete(text);
      body.enqueue(new Uint8Array([1, 2, 3]));
      body.close();
    };
    const fixture = {
      provider,
      bare,
      sent,
      finish,
      rejectNext: (message: string) => {
        rejection = message;
      },
      finishAll: () => {
        for (const text of [...pending.keys()]) finish(text);
      },
    };
    responses.add(fixture);
    return fixture;
  }
  function speak(provider: TtsProvider, text: string, options: Partial<SpeechParams> = {}) {
    return track(provider.generateSpeech({ text, voiceId: 'fixture-voice', ...options }));
  }

  it('keeps a third speech call waiting until an earlier response body is fully consumed', async () => {
    const shared = resource();
    const factorySignal = cancellation().signal;
    const listening = cartesia(shared, { signal: factorySignal });
    const references = cartesia(shared, { signal: factorySignal });
    const first = speak(listening.provider, 'listening segment');
    const second = speak(references.provider, 'speaking reference');
    await expect.poll(() => listening.sent.length + references.sent.length).toBe(2);
    const third = speak(references.provider, 'voice preview');
    await expect.poll(async () => (await sessions(shared)).length).toBe(3);
    await delay(100);
    expect(references.sent).toEqual(['speaking reference']);

    listening.finish('listening segment');
    expect(await first).toEqual(Buffer.from([0x49, 0x44, 0x33, 1, 2, 3]));
    await expect.poll(() => references.sent).toEqual(['speaking reference', 'voice preview']);
    references.finishAll();
    expect(await second).toEqual(await third);
    expect(await redis.exists(semaphoreKey(shared))).toBe(0);
  });

  it('lets another account generate while the shared account is full', async () => {
    const shared = resource();
    const account = cartesia(shared, { signal: cancellation().signal });
    const other = cartesia(resource(), { signal: cancellation().signal });
    const first = speak(account.provider, 'first');
    const second = speak(account.provider, 'second');
    await expect.poll(() => account.sent.length).toBe(2);
    const waiting = speak(account.provider, 'waiting');
    await expect.poll(async () => (await sessions(shared)).length).toBe(3);
    await delay(100);
    const independent = speak(other.provider, 'independent');
    await expect.poll(() => other.sent).toEqual(['independent']);
    expect(account.sent).not.toContain('waiting');
    other.finishAll();
    await independent;
    account.finish('first');
    await first;
    await expect.poll(() => account.sent).toContain('waiting');
    account.finishAll();
    await Promise.all([second, waiting]);
  });

  it('does not acquire again when the timestamp implementation delegates to its own speech method', async () => {
    const shared = resource();
    const controller = cancellation();
    const audio = Buffer.from('timestamp fixture');
    const bare: TtsProvider = {
      providerId: 'cartesia',
      getConcurrencyLimit: async () => 1,
      getVoiceId: () => 'fixture-voice',
      getModelId: () => 'fixture-model',
      async generateSpeech(params) {
        params.signal?.throwIfAborted();
        expect(await redis.zcard(semaphoreKey(shared))).toBe(1);
        return audio;
      },
      async generateSpeechWithTimestamps(params) {
        return {
          audio: await this.generateSpeech(params),
          wordTimings: [{ word: params.text, start: 0, end: 1 }],
        };
      },
    };
    const provider = decorateTtsProvider(bare, { resource: shared, signal: controller.signal });
    const result = await track(
      provider.generateSpeechWithTimestamps!({
        text: 'Hallo',
        voiceId: provider.getVoiceId('HOST'),
      })
    );
    expect(result).toEqual({ audio, wordTimings: [{ word: 'Hallo', start: 0, end: 1 }] });
    expect(await redis.exists(semaphoreKey(shared))).toBe(0);
  });

  it.each(['factory', 'call'] as const)(
    'honors %s cancellation while waiting without sending a request',
    async (source) => {
      const shared = resource();
      const owner = cartesia(shared, { signal: cancellation().signal });
      speak(owner.provider, 'first');
      speak(owner.provider, 'second');
      await expect.poll(() => owner.sent.length).toBe(2);
      const controller = cancellation();
      const waiter = cartesia(shared, {
        signal: source === 'factory' ? controller.signal : cancellation().signal,
      });
      const waiting = speak(waiter.provider, 'cancelled', {
        signal: source === 'call' ? controller.signal : undefined,
      });
      await expect.poll(async () => (await sessions(shared)).length).toBe(3);
      const reason = new Error(`Cancel ${source} speech request`);
      controller.abort(reason);
      await expect(waiting).rejects.toBe(reason);
      expect(waiter.sent).toEqual([]);
      expect(await redis.zcard(semaphoreKey(shared))).toBe(2);
    }
  );

  it('stops waiting when the parent stops without dispatching or consuming another slot', async () => {
    const shared = resource();
    const owner = cartesia(shared, { signal: cancellation().signal });
    speak(owner.provider, 'first');
    speak(owner.provider, 'second');
    await expect.poll(() => owner.sent.length).toBe(2);
    const waiter = cartesia(shared, { signal: cancellation().signal });
    let stopped = false;
    const waiting = speak(waiter.provider, 'stopped', { shouldStop: async () => stopped });
    await expect.poll(async () => (await sessions(shared)).length).toBe(3);
    stopped = true;
    await expect(waiting).rejects.toBeInstanceOf(TtsParentStoppedError);
    expect(waiter.sent).toEqual([]);
    expect(await redis.zcard(semaphoreKey(shared))).toBe(2);
  });

  it('shares the account slots with sound effects without acquiring twice inside a provider', async () => {
    const shared = resource();
    const controller = cancellation();
    const account = cartesia(shared, { signal: controller.signal });
    const bare: TtsProvider = account.bare;
    bare.generateSoundEffect = (params) =>
      bare.generateSpeech({
        text: params.prompt,
        voiceId: 'fixture-voice',
        signal: params.signal,
        onDispatch: params.onDispatch,
        onSettled: params.onSettled,
      });
    const provider = decorateTtsProvider(bare, { resource: shared, signal: controller.signal });
    const first = speak(provider, 'speech one');
    const second = speak(provider, 'speech two');
    await expect.poll(() => account.sent.length).toBe(2);
    const effect = track(
      provider.generateSoundEffect!({ prompt: 'sound effect', durationSeconds: 1 })
    );
    await expect.poll(async () => (await sessions(shared)).length).toBe(3);
    await delay(100);
    expect(account.sent).not.toContain('sound effect');
    account.finish('speech one');
    await first;
    await expect.poll(() => account.sent).toContain('sound effect');
    account.finishAll();
    expect(await second).toEqual(await effect);
  });

  it('propagates a complete 429 and applies the observed account limit to later calls', async () => {
    const shared = resource();
    const account = cartesia(shared, { signal: cancellation().signal });
    account.rejectNext('Too many concurrent requests. Current limit: 1');
    await expect(speak(account.provider, 'rejected')).rejects.toThrow('Cartesia API error (429)');
    expect(await account.bare.getConcurrencyLimit()).toBe(1);
    expect(await redis.exists(semaphoreKey(shared))).toBe(0);
    const first = speak(account.provider, 'one admitted');
    await expect.poll(() => account.sent).toContain('one admitted');
    const second = speak(account.provider, 'second waiting');
    await expect.poll(async () => (await sessions(shared)).length).toBe(2);
    await delay(100);
    expect(account.sent).not.toContain('second waiting');
    account.finishAll();
    await first;
    await expect.poll(() => account.sent).toContain('second waiting');
    account.finishAll();
    await second;
    expect(account.sent).toEqual(['rejected', 'one admitted', 'second waiting']);
  });

  it('rejects successful audio when releasing its capacity token cannot be confirmed', async () => {
    const shared = resource();
    const onCleanupError = vi.fn();
    const account = cartesia(shared, { signal: cancellation().signal, onCleanupError });
    const generating = speak(account.provider, 'release uncertainty');
    await expect.poll(() => account.sent).toEqual(['release uncertainty']);
    await killSession(shared);
    account.finishAll();
    await expect(generating).rejects.toBeInstanceOf(Error);
    expect(onCleanupError.mock.calls.flatMap((entry) => entry)).toEqual(
      expect.arrayContaining([expect.any(Error)])
    );
  });

  it('renews an active token while the response body remains incomplete', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const shared = resource();
    const account = cartesia(shared, { signal: cancellation().signal });
    const generating = speak(account.provider, 'long response');
    await expect.poll(() => account.sent).toEqual(['long response']);
    const before = await redis.zrange(semaphoreKey(shared), '0', '-1', 'WITHSCORES');
    expect(before).toHaveLength(2);
    await delay(20);
    await vi.advanceTimersByTimeAsync(40_001);
    await expect
      .poll(async () => {
        const current = await redis.zscore(semaphoreKey(shared), before[0]!);
        return Number(current);
      })
      .toBeGreaterThan(Number(before[1]));
    account.finishAll();
    expect(await generating).toEqual(Buffer.from([0x49, 0x44, 0x33, 1, 2, 3]));
  });

  it('prevents success after a renewal command has an uncertain outcome', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const shared = resource();
    const onCleanupError = vi.fn();
    const account = cartesia(shared, { signal: cancellation().signal, onCleanupError });
    const generating = speak(account.provider, 'renew uncertainty');
    await expect.poll(() => account.sent).toEqual(['renew uncertainty']);
    await killSession(shared);
    await vi.advanceTimersByTimeAsync(40_001);
    await expect.poll(() => onCleanupError.mock.calls.length).toBeGreaterThan(0);
    account.finishAll();
    await expect(generating).rejects.toBeInstanceOf(Error);
  });
});
