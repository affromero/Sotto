// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createProviderTransport } from 'thesidedoor-core/providers/transport';
import { ResponseBodyTooLargeError } from 'thesidedoor-core/runtime/stream';
import { LocalTtsProvider } from '@/lib/providers/tts/local.provider';
import {
  captureDraftLocalTtsConnection,
  type LocalTtsConnection,
} from '@/lib/providers/shared/local-tts-connection';

const selection: LocalTtsConnection = {
  endpoint: 'http://local-preview.test/tts',
  model: 'local',
  voices: [],
  responseLimits: { maxAudioBytes: 128, maxErrorBytes: 64 },
};

function provider(response: () => Response, connection = selection) {
  return new LocalTtsProvider(
    connection,
    createProviderTransport({
      rules: [{ method: 'POST', url: selection.endpoint }],
      admit: async () => {},
      implementation: async () => response(),
    })
  );
}

describe('bounded local speech previews', () => {
  it('retains the captured keyless model and destination when the original draft changes', () => {
    const mutable = structuredClone(selection);
    const captured = captureDraftLocalTtsConnection(mutable);
    mutable.model = 'another-model';
    mutable.endpoint = 'https://different.test/tts';
    expect(captured.model).toBe('local');
    expect(captured.endpoint).toBe(selection.endpoint);
  });

  it.each([
    { endpoint: 'file:///tmp/tts' },
    { endpoint: 'http://secret@local-preview.test/tts' },
    { endpoint: 'http://local-preview.test/tts?secret=value' },
    { apiKey: 'saved-key' },
    { model: ' ' },
    { responseLimits: { maxAudioBytes: 0, maxErrorBytes: 64 } },
  ])('rejects unsafe or incomplete draft connections: %j', (change) => {
    expect(() => captureDraftLocalTtsConnection({ ...selection, ...change })).toThrow();
  });

  it('cancels oversized preview audio instead of returning a partial success', async () => {
    let cancelled = false;
    const speech = provider(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(129));
            },
            cancel() {
              cancelled = true;
            },
          })
        )
    );
    await expect(speech.generateSpeech({ text: 'Sotto.', voiceId: 'voice' })).rejects.toThrow(
      ResponseBodyTooLargeError
    );
    expect(cancelled).toBe(true);
  });

  it('bounds provider error bodies and never returns them as audio', async () => {
    const speech = provider(() => new Response('x'.repeat(65), { status: 400 }));
    await expect(speech.generateSpeech({ text: 'Sotto.', voiceId: 'voice' })).rejects.toThrow(
      ResponseBodyTooLargeError
    );
  });

  it('preserves ordinary generation response sizes when no preview limits were supplied', async () => {
    const audio = new Uint8Array(129).fill(7);
    const speech = provider(() => new Response(audio), {
      endpoint: selection.endpoint,
      model: selection.model,
      voices: [],
    });
    expect(await speech.generateSpeech({ text: 'Sotto.', voiceId: 'voice' })).toEqual(
      Buffer.from(audio)
    );
  });
});
