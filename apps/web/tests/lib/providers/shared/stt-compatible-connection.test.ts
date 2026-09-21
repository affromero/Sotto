// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createSttProvider } from '@/lib/providers/stt';

// Use the installed SDK while retaining the real HTTP boundary.
vi.mock('openai', async () => {
  const { createRequire } = await import('node:module');
  return { default: createRequire(import.meta.url)('openai') };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each([
  ['together', 'https://api.together.xyz/v1/audio/transcriptions'],
  ['groq', 'https://api.groq.com/openai/v1/audio/transcriptions'],
] as const)(
  'preserves the selected %s Whisper endpoint, key, model and audio',
  async (provider, endpoint) => {
    vi.stubEnv('OPENAI_API_KEY', 'unrelated-owner-key');
    const audio = Buffer.from('RIFF0000WAVEtest-audio');
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(endpoint);
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer selected-owner-key');
      const body = init?.body as FormData;
      expect(body.get('model')).toBe('chosen-transcription-model');
      expect(body.get('language')).toBe('en');
      expect(body.get('response_format')).toBe('verbose_json');
      const file = body.get('file') as File;
      expect(Buffer.from(await file.arrayBuffer())).toEqual(audio);
      return Response.json({
        text: 'Hello',
        language: 'english',
        duration: 1,
        segments: [{ start: 0, end: 1, text: ' Hello ' }],
        words: [{ start: 0, end: 1, word: 'Hello' }],
      });
    });
    expect(
      await createSttProvider(provider, 'selected-owner-key', 'chosen-transcription-model', {
        authenticatedFetch: (input, init) => fetch(input, init),
      }).transcribe(audio, { language: 'en' })
    ).toMatchObject({
      text: 'Hello',
      segments: [{ start: 0, end: 1, text: 'Hello' }],
      words: [{ start: 0, end: 1, word: 'Hello' }],
    });
  }
);
