// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { OpenAITtsProvider } from '@/lib/providers/tts/openai.provider';

vi.mock('openai', async () => {
  const { createRequire } = await import('node:module');
  return { default: createRequire(import.meta.url)('openai') };
});

it.each(['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts'])(
  'sends a compatible voice without changing the selected %s model',
  async (model) => {
    const audio = Buffer.from('selected-provider-audio');
    const provider = new OpenAITtsProvider(
      'selected-key',
      'https://api.openai.com/v1',
      {
        authenticatedFetch: async (input, init) => {
          expect(String(input)).toBe('https://api.openai.com/v1/audio/speech');
          expect(new Headers(init?.headers).get('authorization')).toBe('Bearer selected-key');
          const body = JSON.parse(String(init?.body));
          expect(body).toMatchObject({
            model,
            voice: 'nova',
            input: 'Guten Tag.',
            response_format: 'mp3',
          });
          return new Response(audio, { headers: { 'Content-Type': 'audio/mpeg' } });
        },
      },
      model
    );
    expect(
      await provider.generateSpeech({ text: 'Guten Tag.', voiceId: 'nova', speaker: 'HOST' })
    ).toEqual(audio);
  }
);

it.each(['cedar', 'marin', 'ballad', 'verse', 'unknown-voice'])(
  'rejects unsupported legacy voice %s before dispatch',
  async (voiceId) => {
    const provider = new OpenAITtsProvider(
      'selected-key',
      'https://api.openai.com/v1',
      {
        authenticatedFetch: async () => {
          throw new Error('Unexpected provider dispatch');
        },
      },
      'tts-1-hd'
    );
    await expect(
      provider.generateSpeech({ text: 'Guten Tag.', voiceId, speaker: 'HOST' })
    ).rejects.toThrow(`Voice "${voiceId}" is not supported by OpenAI model "tts-1-hd"`);
  }
);

it.each(['cedar', 'marin'])(
  'preserves the explicit modern voice %s in the provider request',
  async (voiceId) => {
    const provider = new OpenAITtsProvider(
      'selected-key',
      'https://api.openai.com/v1',
      {
        authenticatedFetch: async (_input, init) => {
          expect(JSON.parse(String(init?.body))).toMatchObject({
            model: 'gpt-4o-mini-tts',
            voice: voiceId,
          });
          return new Response('audio', { headers: { 'Content-Type': 'audio/mpeg' } });
        },
      },
      'gpt-4o-mini-tts'
    );
    expect(await provider.generateSpeech({ text: 'Guten Tag.', voiceId, speaker: 'HOST' })).toEqual(
      Buffer.from('audio')
    );
  }
);

it('selects compatible, different legacy roles for the episode that previously chose modern voices', () => {
  const provider = new OpenAITtsProvider(
    'selected-key',
    'https://api.openai.com/v1',
    {
      authenticatedFetch: async () => {
        throw new Error('Voice selection must not dispatch');
      },
    },
    'tts-1-hd'
  );
  const host = provider.getVoiceId('HOST', 'cmvoal7ql003701pj1bes6bvg', { tone: 'socratic' });
  const expert = provider.getVoiceId('EXPERT', 'cmvoal7ql003701pj1bes6bvg', { tone: 'socratic' });
  expect(host).not.toBe(expert);
  for (const voice of [host, expert]) {
    expect(['alloy', 'ash', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer']).toContain(
      voice
    );
  }
});
