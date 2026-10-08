// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@/generated/prisma/client';
import { useProviderCredentialDatabase } from '../../../helpers/runtime/provider-credentials-postgres';
import {
  captureSottoCredentialOwner,
  sottoCredentialStorage,
} from '@/lib/sidedoor/credentials/runtime/provider-credentials';
import { captureConfiguredSottoCredentialProbe } from '@/lib/providers/shared/credential-validation';
import { captureSottoExecutionCredential } from '@/lib/sidedoor/credentials/runtime/credential-execution';
import {
  sottoRequestExecution,
  createSottoProviderTransport,
} from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { captureSpeechAvailability } from '@/lib/providers/shared/speech-availability';
import { createTtsProviderAsync } from '@/lib/providers/tts';
import { resolveSkillRequirementsInTransaction } from '@/lib/learning/skill-requirements';
import { EMPTY_INFRA } from '@/lib/site-config';
import { sidedoorStateStore } from '@/lib/sidedoor/access/state/store';

let database: PrismaClient;
vi.mock('openai', async () => {
  const { createRequire } = await import('node:module');
  return { default: createRequire(import.meta.url)('openai') };
});
vi.mock('@/lib/prisma', () => ({
  get prismaUnfiltered() {
    return database;
  },
}));
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite(
  'captured provider availability with canonical PostgreSQL authority and response consumption',
  () => {
    const fixture = useProviderCredentialDatabase();
    beforeAll(() => {
      database = fixture.database;
    });
    beforeEach(() => {
      vi.restoreAllMocks();
    });
    async function selected(provider = 'cartesia', key = `speech-${randomUUID()}`) {
      await fixture.transaction(async (tx) => {
        const storage = await sottoCredentialStorage(tx, 'tts', provider);
        const owner = await captureSottoCredentialOwner(tx, 'alice');
        const probe = await captureConfiguredSottoCredentialProbe(tx, 'tts', provider, {
          apiKey: key,
        });
        if (probe.kind === 'unsupported') throw new Error('Unsupported fixture provider');
        await storage.owned.replace(
          storage.owned.prepareReplacement(
            { ...storage.slot, owner },
            {
              expectedHeadRevision: null,
              credentialRevision: randomUUID(),
              values: { apiKey: key },
              binding: probe.binding,
              availability: 'enabled',
              label: 'Fixture provider',
              metadata: { createdAt: 1, updatedAt: 1, lastUsedAt: null },
            }
          )
        );
        await sidedoorStateStore(tx).transact((state) => {
          state.configuration.site = { ...EMPTY_INFRA, ttsProvider: provider };
        });
      });
      const admission = await fixture.transaction((tx) => fixture.admission(tx));
      const execution = sottoRequestExecution(admission.request, admission.identity);
      const credential = await fixture.transaction((tx) =>
        captureSottoExecutionCredential(tx, execution.authorize, 'tts', provider, true)
      );
      if (!credential) throw new Error('Missing captured fixture credential');
      const captured = { ...execution, credential };
      const availability = await captureSpeechAvailability(captured);
      if (!availability) throw new Error('Missing fixture availability');
      const origin = new URL(credential.binding.endpoint).origin;
      const transport = await createSottoProviderTransport(captured, [
        { method: 'POST', url: `${origin}/fixture-generation` },
        { method: 'GET', url: `${origin}/fixture-status` },
      ]);
      return { execution: captured, availability, transport, origin };
    }
    const context = {
      scope: 'CLASS' as const,
      nativeLang: 'en',
      targetLang: 'de',
      level: 'A2' as const,
    };
    function wav() {
      const buffer = Buffer.alloc(44 + 3200);
      buffer.write('RIFF');
      buffer.writeUInt32LE(buffer.length - 8, 4);
      buffer.write('WAVEfmt ', 8);
      buffer.writeUInt32LE(16, 16);
      buffer.writeUInt16LE(1, 20);
      buffer.writeUInt16LE(1, 22);
      buffer.writeUInt32LE(16000, 24);
      buffer.writeUInt32LE(32000, 28);
      buffer.writeUInt16LE(2, 32);
      buffer.writeUInt16LE(16, 34);
      buffer.write('data', 36);
      buffer.writeUInt32LE(3200, 40);
      return buffer;
    }
    async function consume(account: Awaited<ReturnType<typeof selected>>, response: Response) {
      vi.stubGlobal('fetch', async () => response);
      return (
        await account.transport.authenticatedFetch(`${account.origin}/fixture-generation`, {
          method: 'POST',
        })
      ).text();
    }

    it.each([
      ['cartesia', 402, 'Model credits limit reached: restore your subscription'],
      ['openai', 429, JSON.stringify({ error: { code: 'insufficient_quota' } })],
      ['elevenlabs', 401, JSON.stringify({ detail: { status: 'quota_exceeded' } })],
    ])(
      'blocks selected %s generation only after its complete documented quota response',
      async (provider, status, body) => {
        const account = await selected(provider);
        expect(await consume(account, new Response(body, { status }))).toBe(body);
        expect(await account.availability.status()).toMatchObject({
          state: 'credits_exhausted',
          checkedAt: expect.any(Number),
        });
        await expect(
          fixture.transaction((tx) =>
            resolveSkillRequirementsInTransaction(tx, account.execution, context)
          )
        ).rejects.toMatchObject({ code: 'PROVIDER_CREDITS_EXHAUSTED', provider });
        vi.stubGlobal('fetch', async () => {
          throw new Error('A blocked request reached the provider');
        });
        await expect(
          account.transport.authenticatedFetch(`${account.origin}/fixture-generation`, {
            method: 'POST',
          })
        ).rejects.toMatchObject({ code: 'PROVIDER_CREDITS_EXHAUSTED' });
      }
    );

    it.each([
      [402, 'Different payment error'],
      [401, 'Model credits limit reached:'],
      [403, 'Forbidden'],
      [429, 'Rate limit'],
      [500, 'Model credits limit reached:'],
      [402, 'Model credits limit reached:' + 'x'.repeat(32 * 1024)],
    ])(
      'preserves an unclassified HTTP%s body without inventing quota exhaustion',
      async (status, body) => {
        const account = await selected();
        expect(await consume(account, new Response(body, { status }))).toBe(body);
        expect(await account.availability.status()).toEqual({
          state: 'unobserved',
          checkedAt: null,
        });
      }
    );

    it('preserves status, headers and response provenance and settles only a fully consumed body', async () => {
      const account = await selected();
      const response = new Response('Model credits limit reached: exhausted', {
        status: 402,
        statusText: 'Payment Required',
        headers: { 'x-provider': 'original' },
      });
      Object.defineProperties(response, {
        url: { value: `${account.origin}/fixture-generation` },
        type: { value: 'basic' },
      });
      vi.stubGlobal('fetch', async () => response);
      const events: string[] = [];
      const observed = await account.transport.authenticatedFetch(
        `${account.origin}/fixture-generation`,
        { method: 'POST' },
        { onDispatch: () => events.push('dispatched'), onConsumed: () => events.push('consumed') }
      );
      expect({
        status: observed.status,
        statusText: observed.statusText,
        header: observed.headers.get('x-provider'),
        url: observed.url,
        type: observed.type,
      }).toEqual({
        status: 402,
        statusText: 'Payment Required',
        header: 'original',
        url: `${account.origin}/fixture-generation`,
        type: 'basic',
      });
      expect(events).toEqual(['dispatched']);
      await observed.text();
      expect(events).toEqual(['dispatched', 'consumed']);
      expect((await account.availability.status()).state).toBe('credits_exhausted');
    });

    it('does not classify a canceled partial body or a body read failure', async () => {
      const account = await selected();
      let canceled = false;
      const events: string[] = [];
      vi.stubGlobal(
        'fetch',
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('Model credits limit reached:'));
              },
              cancel() {
                canceled = true;
              },
            }),
            { status: 402 }
          )
      );
      const response = await account.transport.authenticatedFetch(
        `${account.origin}/fixture-generation`,
        { method: 'POST' },
        { onDispatch: () => events.push('dispatched'), onConsumed: () => events.push('consumed') }
      );
      const reader = response.body!.getReader();
      await reader.read();
      await reader.cancel();
      expect(canceled).toBe(true);
      expect(events).toEqual(['dispatched']);
      expect((await account.availability.status()).state).toBe('unobserved');
      vi.stubGlobal(
        'fetch',
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new Error('Truncated provider response'));
              },
            }),
            { status: 402 }
          )
      );
      await expect(
        (
          await account.transport.authenticatedFetch(`${account.origin}/fixture-generation`, {
            method: 'POST',
          })
        ).text()
      ).rejects.toThrow('Truncated provider response');
      expect((await account.availability.status()).state).toBe('unobserved');
    });

    it('records genuine body consumption before a revoked credential prevents quota persistence', async () => {
      const account = await selected();
      const events: string[] = [];
      vi.stubGlobal(
        'fetch',
        async () => new Response('Model credits limit reached: exhausted', { status: 402 })
      );
      const response = await account.transport.authenticatedFetch(
        `${account.origin}/fixture-generation`,
        { method: 'POST' },
        { onDispatch: () => events.push('dispatched'), onConsumed: () => events.push('consumed') }
      );
      await fixture.transaction(async (tx) => {
        const storage = await sottoCredentialStorage(tx, 'tts', 'cartesia');
        const owner = await captureSottoCredentialOwner(tx, 'alice');
        await storage.owned.remove(
          { ...storage.slot, owner },
          account.execution.credential.selected.credential.credentialRevision,
          randomUUID()
        );
      });
      await expect(response.text()).rejects.toThrow();
      expect(events).toEqual(['dispatched', 'consumed']);
      await expect(account.availability.status()).rejects.toThrow();
    });

    it('allows status polling after credit exhaustion while keeping new paid requests blocked', async () => {
      const account = await selected();
      await consume(
        account,
        new Response('Model credits limit reached: exhausted', { status: 402 })
      );
      vi.stubGlobal('fetch', async () => new Response('completed'));
      expect(
        await (
          await account.transport.authenticatedFetch(`${account.origin}/fixture-status`)
        ).text()
      ).toBe('completed');
      expect((await account.availability.status()).state).toBe('credits_exhausted');
    });

    it('shares the actual billing account with transcription and preserves exhaustion after optional metadata changes', async () => {
      const account = await selected();
      await consume(
        account,
        new Response('Model credits limit reached: exhausted', { status: 402 })
      );
      const sttCredential = await fixture.transaction((tx) =>
        captureSottoExecutionCredential(tx, account.execution.authorize, 'stt', 'cartesia', true)
      );
      const sttAvailability = await captureSpeechAvailability({
        ...account.execution,
        credential: sttCredential,
      });
      expect((await sttAvailability!.status()).state).toBe('credits_exhausted');
      await fixture.transaction(async (tx) => {
        const storage = await sottoCredentialStorage(tx, 'tts', 'cartesia');
        const owner = await captureSottoCredentialOwner(tx, 'alice');
        const head = await storage.owned.head({ ...storage.slot, owner });
        const prior = account.execution.credential.selected.credential;
        await storage.owned.replace(
          storage.owned.prepareReplacement(
            { ...storage.slot, owner },
            {
              expectedHeadRevision: head.revision,
              credentialRevision: randomUUID(),
              values: {
                ...prior.values,
                adminApiKey: 'optional-admin-key',
                monthlyCreditLimit: 250000,
              },
              binding: prior.binding,
              availability: 'enabled',
              label: 'Changed usage metadata',
              metadata: { ...prior.metadata, updatedAt: Date.now() },
            }
          )
        );
      });
      const fresh = await fixture.transaction((tx) =>
        captureSottoExecutionCredential(tx, account.execution.authorize, 'tts', 'cartesia', true)
      );
      const availability = await captureSpeechAvailability({
        ...account.execution,
        credential: fresh,
      });
      expect((await availability!.status()).state).toBe('credits_exhausted');
    });

    it('preserves a newer actual failure that arrives during a successful explicit check', async () => {
      const account = await selected();
      let startFailure!: () => void;
      vi.stubGlobal(
        'fetch',
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                startFailure = () => {
                  controller.enqueue(
                    new TextEncoder().encode('Model credits limit reached: newer failure')
                  );
                  controller.close();
                };
              },
            }),
            { status: 402 }
          )
      );
      const admitted = await account.transport.authenticatedFetch(
        `${account.origin}/fixture-generation`,
        { method: 'POST' }
      );
      const concurrent = admitted.text();
      await consume(
        account,
        new Response('Model credits limit reached: exhausted', { status: 402 })
      );
      vi.stubGlobal('fetch', async () => new Response(new Uint8Array(wav())));
      const provider = await createTtsProviderAsync('cartesia', account.execution);
      await expect(
        account.availability.recheck(async () => {
          const audio = await provider.generateSpeech({
            text: 'Sotto.',
            voiceId: provider.getVoiceId('HOST'),
          });
          startFailure();
          await concurrent;
          return audio;
        })
      ).rejects.toMatchObject({ code: 'PROVIDER_CREDITS_EXHAUSTED' });
      expect((await account.availability.status()).state).toBe('credits_exhausted');
    });

    it('returns a typed first quota failure through the canonical factory with its adapter cause', async () => {
      const account = await selected();
      vi.stubGlobal(
        'fetch',
        async () => new Response('Model credits limit reached: exhausted', { status: 402 })
      );
      const provider = await createTtsProviderAsync('cartesia', account.execution);
      await expect(
        provider.generateSpeech({ text: 'Sotto.', voiceId: provider.getVoiceId('HOST') })
      ).rejects.toMatchObject({
        code: 'PROVIDER_CREDITS_EXHAUSTED',
        provider: 'cartesia',
        cause: expect.objectContaining({ message: expect.stringContaining('402') }),
      });
      expect((await account.availability.status()).state).toBe('credits_exhausted');
    });

    it.each(['timestamps', 'sound_effect'] as const)(
      'preserves typed quota failure and settlement for canonical %s generation',
      async (mode) => {
        const account = await selected('elevenlabs');
        vi.stubGlobal('fetch', async (input: RequestInfo | URL) =>
          new Request(input).method === 'GET'
            ? Response.json({ tier: 'creator', character_count: 0, character_limit: 1000 })
            : Response.json({ detail: { status: 'quota_exceeded' } }, { status: 401 })
        );
        const provider = await createTtsProviderAsync('elevenlabs', account.execution);
        const outcomes: string[] = [];
        const callbacks = {
          onDispatch: () => outcomes.push('dispatched'),
          onSettled: () => outcomes.push('settled'),
        };
        const result =
          mode === 'timestamps'
            ? provider.generateSpeechWithTimestamps!({
                text: 'Sotto.',
                voiceId: provider.getVoiceId('HOST'),
                ...callbacks,
              })
            : provider.generateSoundEffect!({ prompt: 'A quiet chime.', ...callbacks });
        await expect(result).rejects.toMatchObject({
          code: 'PROVIDER_CREDITS_EXHAUSTED',
          provider: 'elevenlabs',
          cause: expect.any(Error),
        });
        expect(outcomes).toEqual(['dispatched', 'settled']);
        expect((await account.availability.status()).state).toBe('credits_exhausted');
      }
    );

    it('verifies one actual canonical HTTP200 audio response and decoded duration before clearing', async () => {
      const account = await selected();
      await consume(
        account,
        new Response('Model credits limit reached: exhausted', { status: 402 })
      );
      vi.stubGlobal('fetch', async () => new Response(new Uint8Array(wav())));
      const provider = await createTtsProviderAsync('cartesia', account.execution);
      await account.availability.recheck(() =>
        provider.generateSpeech({ text: 'Sotto.', voiceId: provider.getVoiceId('HOST') })
      );
      expect(await account.availability.status()).toMatchObject({
        state: 'verified_available',
        checkedAt: expect.any(Number),
      });
    });

    it.each(['openai', 'elevenlabs'] as const)(
      'verifies %s canonical HTTP200 direct audio through the same availability check',
      async (providerId) => {
        const account = await selected(providerId);
        vi.stubGlobal('fetch', async (input: RequestInfo | URL) =>
          new Request(input).method === 'GET'
            ? Response.json({ tier: 'creator', character_count: 0, character_limit: 1000 })
            : new Response(new Uint8Array(wav()))
        );
        const provider = await createTtsProviderAsync(providerId, account.execution);
        await account.availability.recheck(() =>
          provider.generateSpeech({ text: 'Sotto.', voiceId: provider.getVoiceId('HOST') })
        );
        expect((await account.availability.status()).state).toBe('verified_available');
      }
    );

    it.each([206, 200])(
      'retains exhaustion when HTTP%s cannot prove valid decoded speech',
      async (status) => {
        const account = await selected();
        await consume(
          account,
          new Response('Model credits limit reached: exhausted', { status: 402 })
        );
        vi.stubGlobal(
          'fetch',
          async () =>
            new Response(new Uint8Array(status === 206 ? wav() : Buffer.from('not audio')), {
              status,
            })
        );
        const provider = await createTtsProviderAsync('cartesia', account.execution);
        await expect(
          account.availability.recheck(() =>
            provider.generateSpeech({ text: 'Sotto.', voiceId: provider.getVoiceId('HOST') })
          )
        ).rejects.toThrow();
        expect((await account.availability.status()).state).toBe('credits_exhausted');
      }
    );

    it('does not let an unrelated request use the explicit check permit or replay it twice', async () => {
      const account = await selected();
      await consume(
        account,
        new Response('Model credits limit reached: exhausted', { status: 402 })
      );
      const provider = await createTtsProviderAsync('cartesia', account.execution);
      vi.stubGlobal('fetch', async () => new Response(new Uint8Array(wav())));
      await expect(
        account.availability.recheck(async () => {
          await provider.generateSpeech({
            text: 'First check.',
            voiceId: provider.getVoiceId('HOST'),
          });
          return provider.generateSpeech({
            text: 'Second check.',
            voiceId: provider.getVoiceId('HOST'),
          });
        })
      ).rejects.toThrow('one provider request');
      expect((await account.availability.status()).state).toBe('credits_exhausted');
    });

    it('fails closed after the captured credential is replaced or cancellation is requested', async () => {
      const account = await selected();
      const aborted = new AbortController();
      aborted.abort(new Error('Canceled availability check'));
      await expect(account.availability.recheck(async () => wav(), aborted.signal)).rejects.toThrow(
        'Canceled availability check'
      );
      await fixture.transaction(async (tx) => {
        const storage = await sottoCredentialStorage(tx, 'tts', 'cartesia');
        const owner = await captureSottoCredentialOwner(tx, 'alice');
        await storage.owned.remove(
          { ...storage.slot, owner },
          account.execution.credential.selected.credential.credentialRevision,
          randomUUID()
        );
      });
      await expect(account.availability.status()).rejects.toThrow();
      vi.stubGlobal('fetch', async () => {
        throw new Error('An erased credential reached the provider');
      });
      await expect(
        account.transport.authenticatedFetch(`${account.origin}/fixture-generation`, {
          method: 'POST',
        })
      ).rejects.toThrow();
    });
  }
);
