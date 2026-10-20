// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bindSottoCredentialProbe,
  captureSottoCredentialDestination,
  captureSottoCredentialProbe,
  validateSottoCredentialProbe,
} from '@/lib/providers/shared/credential-validation';
import { CARTESIA_TTS_API_VERSION } from '@/lib/providers/shared/speech-contracts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('captured credential destinations', () => {
  it.each(['', '/'])(
    'keeps a reviewed compatible route and captured key with suffix "%s"',
    async (suffix) => {
      const received: Request[] = [];
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, options?: RequestInit) => {
        received.push(new Request(input, options));
        return Response.json({ data: [{ id: 'classroom-model' }], object: 'list' });
      });
      const endpoint = `http://127.0.0.1:18300/v1${suffix}`;
      const destination = captureSottoCredentialDestination('ai', 'local', endpoint);
      const values = { apiKey: 'captured-probe-secret' };
      const probe = bindSottoCredentialProbe(destination, values);
      values.apiKey = 'later-edit';
      expect(destination.kind === 'api' && destination.requiresEndpointReview).toBe(true);
      expect(probe.kind !== 'unsupported' && probe.binding.endpoint).toBe(endpoint);
      expect(await validateSottoCredentialProbe(probe)).toMatchObject({
        readiness: { code: 'ready' },
      });
      expect(received.map((request) => request.url)).toEqual(['http://127.0.0.1:18300/v1/models']);
      expect(received[0]!.headers.get('authorization')).toBe('Bearer captured-probe-secret');
    }
  );

  it('requires configured local destination evidence instead of borrowing an environment URL', () => {
    vi.stubEnv('OPENAI_BASE_URL', 'https://unreviewed.example/v1');
    expect(() => captureSottoCredentialDestination('ai', 'local')).toThrow(/local AI endpoint/);
  });

  it('does not borrow an environment API key when binding an empty field set', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'environment-secret');
    const received: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      received.push(String(input));
      throw new Error('A missing personal key must not reach the provider');
    });
    const probe = bindSottoCredentialProbe(captureSottoCredentialDestination('ai', 'openai'), {});
    expect(await validateSottoCredentialProbe(probe)).toMatchObject({ status: 'missing' });
    expect(received).toEqual([]);
  });

  it('keeps speech and transcription protocol versions distinct for a shared account', () => {
    const speech = captureSottoCredentialDestination('tts', 'cartesia');
    const transcription = captureSottoCredentialDestination('stt', 'cartesia');
    expect(speech.kind !== 'unsupported' && speech.binding.protocol).toBe(
      `cartesia:${CARTESIA_TTS_API_VERSION}`
    );
    expect(transcription.kind !== 'unsupported' && transcription.binding.protocol).toBe(
      'cartesia:2026-03-01'
    );
    expect(speech.kind !== 'unsupported' && speech.binding.endpoint).toBe(
      transcription.kind !== 'unsupported' && transcription.binding.endpoint
    );
  });

  it('rejects cancelled validation before HTTP dispatch', async () => {
    const lifetime = new AbortController();
    lifetime.abort();
    await expect(
      validateSottoCredentialProbe(
        captureSottoCredentialProbe('ai', 'openai', { apiKey: 'personal-secret' }),
        lifetime.signal
      )
    ).rejects.toThrow();
  });
});
