import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProviderTransport } from 'thesidedoor-core/providers/transport';
import { FishProvider } from '@/lib/providers/tts/fish/fish.provider';
import { resolveTtsProvider } from '@/lib/providers/tts';
import { getDefaultModelForLanguage, supportsLanguage } from '@/lib/tts-language-support';
import { SOTTO_LANGUAGE_CODES } from '@/lib/speech-language-support';
import { FISH_VOICE_POOL } from '@/lib/providers/tts-voices';
import {
  assertTtsModelAvailable,
  estimateTtsCost,
  getProviderMeta,
} from '@/lib/providers/tts-registry';
import { getTtsModelLabel, getTtsProviderLabel } from '@sotto/shared';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function boundary(response = new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x00]))) {
  const requests: Request[] = [];
  const transport = createProviderTransport({
    rules: [{ method: 'POST', url: FishProvider.speechEndpoint }],
    admit: async () => {},
    implementation: async (input, init) => {
      requests.push(new Request(input, init));
      return response;
    },
  });
  return { transport, requests };
}

describe('Fish Audio', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('stops free access at its guaranteed deadline without choosing a paid model', async () => {
    expect(() =>
      assertTtsModelAvailable('fish', 's2.1-pro-free', new Date('2026-11-30T23:59:59Z'))
    ).not.toThrow();
    const { transport, requests } = boundary();
    const provider = new FishProvider('key', transport);
    vi.setSystemTime(new Date('2026-12-01T00:00:00Z'));
    expect(() => new FishProvider('key', transport)).toThrow('availability must be reverified');
    await expect(
      provider.generateSpeech({ text: 'Hallo', voiceId: FISH_VOICE_POOL[0].id })
    ).rejects.toThrow('availability must be reverified');
    expect(requests).toEqual([]);
    expect(() => new FishProvider('key', transport, 'drama-3')).not.toThrow();
  });

  it('stops a free request that crosses the deadline during credential admission', async () => {
    const requests: Request[] = [];
    let dispatched = false;
    const transport = createProviderTransport({
      rules: [{ method: 'POST', url: FishProvider.speechEndpoint }],
      admit: async () => {
        vi.setSystemTime(new Date('2026-12-01T00:00:00Z'));
      },
      implementation: async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(new Uint8Array([1]));
      },
    });
    vi.setSystemTime(new Date('2026-11-30T23:59:59Z'));
    const provider = new FishProvider('key', transport);
    await expect(
      provider.generateSpeech({
        text: 'Hallo',
        voiceId: FISH_VOICE_POOL[0].id,
        onDispatch: () => {
          dispatched = true;
        },
      })
    ).rejects.toThrow('availability must be reverified');
    expect(requests).toEqual([]);
    expect(dispatched).toBe(false);
  });

  it('rechecks activation immediately before dispatch after asynchronous admission', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'sotto-fish-dispatch-'));
    const path = join(directory, 'fish.json');
    const activation = (fishEnabled: boolean) =>
      writeFileSync(path, JSON.stringify({ releaseSha: 'a'.repeat(40), fishEnabled }));
    vi.stubEnv('SOTTO_PROVIDER_ACTIVATION_FILE', path);
    vi.stubEnv('SOTTO_RELEASE_SHA', 'a'.repeat(40));
    activation(true);
    const requests: Request[] = [];
    const transport = createProviderTransport({
      rules: [{ method: 'POST', url: FishProvider.speechEndpoint }],
      admit: async () => activation(false),
      implementation: async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(new Uint8Array([1]));
      },
    });
    try {
      await expect(
        new FishProvider('key', transport).generateSpeech({ text: 'Hallo', voiceId: 'voice' })
      ).rejects.toThrow('being enabled');
      expect(requests).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it.each(['s2.1-pro-free', 'drama-3', 's2.1-pro', 's2-pro'])(
    'sends the exact %s model and preserves multilingual text and direction',
    async (model) => {
      const { transport, requests } = boundary();
      const provider = new FishProvider('selected-key', transport, model);
      const text = 'Hallo! [pause] ¡Hola! こんにちは。';
      let settled = false;
      const audio = await provider.generateSpeech({
        text,
        voiceId: FISH_VOICE_POOL[0].id,
        direction: 'calm, clear',
        language: 'de',
        onSettled: () => {
          settled = true;
        },
      });
      expect(audio).toEqual(Buffer.from([0xff, 0xfb, 0x90, 0x00]));
      const request = requests[0];
      expect(request.url).toBe(FishProvider.speechEndpoint);
      expect(request.method).toBe('POST');
      expect(request.headers.get('authorization')).toBe('Bearer selected-key');
      expect(request.headers.get('model')).toBe(model);
      expect(await request.json()).toMatchObject({
        text: `[calm, clear] ${text}`,
        reference_id: FISH_VOICE_POOL[0].id,
        format: 'mp3',
        latency: 'normal',
      });
      expect(settled).toBe(true);
    }
  );

  it('keeps the free model by default for every Sotto language', () => {
    const { transport } = boundary();
    expect(new FishProvider('key', transport).getModelId()).toBe('s2.1-pro-free');
    for (const language of SOTTO_LANGUAGE_CODES) {
      expect(getDefaultModelForLanguage('fish', language)).toBe('s2.1-pro-free');
      for (const model of getProviderMeta('fish').models)
        expect(supportsLanguage('fish', model.id, language)).toBe(true);
    }
  });

  it('keeps an explicit paid choice and rejects misspelled models before admission', async () => {
    const { transport, requests } = boundary();
    expect(getDefaultModelForLanguage('fish', 'de', 'drama-3')).toBe('drama-3');
    expect(getDefaultModelForLanguage('fish', 'de', 'drmaa-3')).toBeNull();
    expect(() => new FishProvider('key', transport, 'drmaa-3')).toThrow('Unknown Fish Audio model');
    await expect(
      resolveTtsProvider({
        userId: 'learner',
        episodeId: 'episode',
        requestedProvider: 'fish',
        requestedModel: 'drmaa-3',
        language: 'de',
        execution: {
          authorize: async () => {
            throw new Error('Unexpected admission');
          },
        },
      })
    ).rejects.toThrow('Unknown Fish Audio model');
    expect(requests).toEqual([]);
  });

  it('reports paid credit failures and leaves the free model selectable', async () => {
    const { transport } = boundary(
      Response.json({ status: 402, message: 'Insufficient API credit.' }, { status: 402 })
    );
    await expect(
      new FishProvider('key', transport, 'drama-3').generateSpeech({
        text: 'Hallo',
        voiceId: FISH_VOICE_POOL[0].id,
      })
    ).rejects.toThrow('Fish Audio TTS error (402):');
    expect(getDefaultModelForLanguage('fish', 'de')).toBe('s2.1-pro-free');
  });

  it('does not dispatch cancelled speech', async () => {
    const { transport, requests } = boundary();
    await expect(
      new FishProvider('key', transport).generateSpeech({
        text: 'Hallo',
        voiceId: FISH_VOICE_POOL[0].id,
        signal: AbortSignal.abort(),
      })
    ).rejects.toThrow();
    expect(requests).toEqual([]);
  });

  it('rejects empty successful responses', async () => {
    const { transport } = boundary(new Response(new Uint8Array()));
    await expect(
      new FishProvider('key', transport).generateSpeech({
        text: 'Hallo',
        voiceId: FISH_VOICE_POOL[0].id,
      })
    ).rejects.toThrow('returned empty audio');
  });

  it('estimates UTF-8 billing and expires the Drama launch price', () => {
    const text = '你好';
    expect(estimateTtsCost('fish', 's2.1-pro-free', text)).toBe(0);
    expect(estimateTtsCost('fish', 'drama-3', text, new Date('2026-10-14'))).toBeCloseTo(
      (6 * 10) / 1_000_000
    );
    expect(estimateTtsCost('fish', 'drama-3', text, new Date('2026-11-13'))).toBeCloseTo(
      (6 * 50) / 1_000_000
    );
    expect(estimateTtsCost('fish', 's2.1-pro', text)).toBeCloseTo((6 * 15) / 1_000_000);
    expect(getTtsProviderLabel('fish')).toBe('Fish');
    expect(getTtsModelLabel('drama-3')).toBe('Drama 3');
  });
});
