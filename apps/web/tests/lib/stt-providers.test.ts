import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const serverConfiguration = vi.hoisted(() => ({
  values: {} as Record<string, string | undefined>,
}));
vi.mock('@/lib/server-config', () => ({
  infra: (key: string) => serverConfiguration.values[key],
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockTranscriptionsCreate = vi.fn();

const mockGetAiKey = vi.fn();
const mockGetByokKey = vi.fn();

vi.mock('@/lib/byok', () => ({
  getAiKey: (...args: unknown[]) => mockGetAiKey(...args),
  getByokKey: (...args: unknown[]) => mockGetByokKey(...args),
  getSharedAiKey: (...args: unknown[]) => mockGetAiKey(...args),
  getSharedByokKey: async (...args: unknown[]) => {
    const key = await mockGetByokKey(...args);
    return key ? { apiKey: key, ownerUserId: args[0] as string, shared: false } : null;
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {},
}));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    audio = {
      transcriptions: {
        create: mockTranscriptionsCreate,
      },
    };
    constructor(public opts?: Record<string, unknown>) {}
  },
}));

import {
  createSttProvider as createCapturedSttProvider,
  getConfiguredSttProviderId,
} from '@/lib/providers/stt';
import type { SttProviderId } from '@/lib/providers/stt-registry';
import { getDefaultSttModelForLanguage, supportsSttLanguage } from '@/lib/providers/stt-registry';
import {
  isValidAiProviderId,
  getAiProviderMeta,
  getAiProviderIds,
} from '@/lib/providers/ai-registry';

const testTransport = {
  authenticatedFetch: (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    fetch(input, init),
};
const createSttProvider = (provider?: SttProviderId, apiKey?: string, model?: string) =>
  createCapturedSttProvider(provider, apiKey, model, testTransport);

describe('createSttProvider', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mockTranscriptionsCreate.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns an openai provider by default', () => {
    const provider = createSttProvider(undefined, 'sk-test-key');
    expect(provider).toBeDefined();
    expect(provider.transcribe).toBeInstanceOf(Function);
  });

  it('returns an openai provider for "openai"', () => {
    const provider = createSttProvider('openai', 'sk-test-key');
    expect(provider).toBeDefined();
  });

  it('returns an elevenlabs provider for "elevenlabs"', () => {
    const provider = createSttProvider('elevenlabs', 'test-key');
    expect(provider).toBeDefined();
    expect(provider.transcribe).toBeInstanceOf(Function);
  });

  it('maps Sotto language codes to ElevenLabs Scribe codes and normalizes the result', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_url, init) => {
      expect(new Headers(init?.headers).get('xi-api-key')).toBe('xi-test');
      const form = (init as RequestInit).body as FormData;
      expect(form.get('language_code')).toBe('spa');
      return new Response(
        JSON.stringify({
          text: 'Hola.',
          language_code: 'spa',
          words: [{ text: 'Hola.', start: 0, end: 1, type: 'word' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    try {
      const provider = createSttProvider('elevenlabs', 'xi-test');
      const result = await provider.transcribe(Buffer.from('audio'), { language: 'es' });
      expect(result.language).toBe('es');
      expect(result.text).toBe('Hola.');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('openai provider rejects a missing captured key', () => {
    expect(() => createSttProvider('openai')).toThrow('No API key provided');
  });

  it('openai provider uses whisper-1 model', async () => {
    // Warm up vitest mock module cache for dynamic import('openai') in loadClient
    await import('openai');
    const provider = createSttProvider('openai', 'sk-test');

    mockTranscriptionsCreate.mockResolvedValueOnce({
      text: 'hello',
      language: 'en',
      segments: [{ start: 0, end: 1, text: 'hello' }],
    });

    await provider.transcribe(Buffer.from('audio'));
    expect(mockTranscriptionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'whisper-1',
      })
    );
  });

  it('surfaces unsupported verbose_json instead of silently changing response format', async () => {
    await import('openai');
    const provider = createSttProvider('together', 'tog-test');

    mockTranscriptionsCreate.mockRejectedValueOnce(new Error('verbose_json is not supported'));

    await expect(provider.transcribe(Buffer.from('audio'))).rejects.toThrow(
      'verbose_json is not supported'
    );
    expect(mockTranscriptionsCreate).toHaveBeenCalledTimes(1);
  });

  it('returns a together provider for "together"', () => {
    const provider = createSttProvider('together', 'tog-test-key');
    expect(provider).toBeDefined();
    expect(provider.transcribe).toBeInstanceOf(Function);
  });

  it('together provider uses correct model', async () => {
    await import('openai');
    const provider = createSttProvider('together', 'tog-test');

    mockTranscriptionsCreate.mockResolvedValueOnce({
      text: 'hello',
      language: 'en',
      segments: [{ start: 0, end: 1, text: 'hello' }],
    });

    await provider.transcribe(Buffer.from('audio'));
    expect(mockTranscriptionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'openai/whisper-large-v3',
        response_format: 'verbose_json',
      })
    );
  });

  it('returns a deepgram provider for "deepgram"', () => {
    const provider = createSttProvider('deepgram', 'dg-test-key');
    expect(provider).toBeDefined();
    expect(provider.transcribe).toBeInstanceOf(Function);
  });

  it('deepgram provider throws without API key', () => {
    vi.stubEnv('DEEPGRAM_API_KEY', '');
    expect(() => createSttProvider('deepgram')).toThrow('No Deepgram API key provided');
  });

  it('returns an assemblyai provider for "assemblyai"', () => {
    const provider = createSttProvider('assemblyai', 'aai-test-key');
    expect(provider).toBeDefined();
    expect(provider.transcribe).toBeInstanceOf(Function);
  });

  it('assemblyai provider throws without API key', () => {
    vi.stubEnv('ASSEMBLYAI_API_KEY', '');
    expect(() => createSttProvider('assemblyai')).toThrow('No AssemblyAI API key provided');
  });

  it('returns a cartesia provider for "cartesia"', () => {
    const provider = createSttProvider('cartesia', 'sk_car_test');
    expect(provider).toBeDefined();
    expect(provider.transcribe).toBeInstanceOf(Function);
  });

  it('cartesia provider throws without API key', () => {
    vi.stubEnv('CARTESIA_API_KEY', '');
    expect(() => createSttProvider('cartesia')).toThrow('No Cartesia API key provided');
  });

  it('cartesia provider normalizes selected STT language codes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_url, init) => {
      const form = (init as RequestInit).body as FormData;
      expect(form.get('language')).toBe('de');
      return new Response(JSON.stringify({ text: 'Hallo.', language: 'de' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    try {
      const provider = createSttProvider('cartesia', 'sk_car_test');
      const result = await provider.transcribe(Buffer.from('audio'), { language: 'de-DE' });
      expect(result.language).toBe('de');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('returns a groq provider for "groq" (OpenAI-compatible)', () => {
    const provider = createSttProvider('groq', 'gsk_test');
    expect(provider).toBeDefined();
    expect(provider.transcribe).toBeInstanceOf(Function);
  });

  it('returns a gladia provider for "gladia"', () => {
    const provider = createSttProvider('gladia', 'gladia_test');
    expect(provider).toBeDefined();
    expect(provider.transcribe).toBeInstanceOf(Function);
  });

  it('gladia provider throws without API key', () => {
    vi.stubEnv('GLADIA_API_KEY', '');
    expect(() => createSttProvider('gladia')).toThrow('No Gladia API key provided');
  });

  it('gladia provider normalizes selected STT language codes', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(async () => {
        return new Response(JSON.stringify({ audio_url: 'https://audio.example/test.wav' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      })
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse((init as RequestInit).body as string);
        expect(body.language_config.languages).toEqual(['de']);
        return new Response('invalid', { status: 400 });
      });

    try {
      const provider = createSttProvider('gladia', 'gladia_test');
      await expect(
        provider.transcribe(Buffer.from('audio'), { language: 'de-DE' })
      ).rejects.toThrow('Gladia submit error (400)');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('returns a speechmatics provider for "speechmatics"', () => {
    const provider = createSttProvider('speechmatics', 'sm_test');
    expect(provider).toBeDefined();
    expect(provider.transcribe).toBeInstanceOf(Function);
  });

  it('speechmatics provider throws without API key', () => {
    vi.stubEnv('SPEECHMATICS_API_KEY', '');
    expect(() => createSttProvider('speechmatics')).toThrow('No Speechmatics API key provided');
  });

  it('speechmatics provider maps Sotto Chinese to the Speechmatics Mandarin code', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_url, init) => {
      const form = (init as RequestInit).body as FormData;
      const config = JSON.parse(form.get('config') as string);
      expect(config.transcription_config.language).toBe('cmn');
      return new Response('invalid', { status: 400 });
    });

    try {
      const provider = createSttProvider('speechmatics', 'sm_test');
      await expect(provider.transcribe(Buffer.from('audio'), { language: 'zh' })).rejects.toThrow(
        'Speechmatics submit error (400)'
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('local provider throws without a shared STT endpoint', () => {
    serverConfiguration.values = {};
    expect(() => createSttProvider('local', 'local')).toThrow(
      'Save a base URL for the local STT provider'
    );
  });

  it('local provider points the OpenAI SDK at the shared endpoint and model', async () => {
    await import('openai');
    serverConfiguration.values = {
      sttBaseUrl: 'http://localhost:8000/v1',
      sttModel: 'whisper-large-v3-turbo',
    };
    const provider = createSttProvider('local', 'local');

    mockTranscriptionsCreate.mockResolvedValueOnce({
      text: 'hola',
      language: 'es',
      segments: [{ start: 0, end: 1, text: 'hola' }],
    });

    await provider.transcribe(Buffer.from('audio'));
    expect(mockTranscriptionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'whisper-large-v3-turbo' })
    );
  });
});

describe('AI Registry — new STT-only providers', () => {
  it('includes together in provider IDs', () => {
    expect(getAiProviderIds()).toContain('together');
  });

  it('includes deepgram in provider IDs', () => {
    expect(getAiProviderIds()).toContain('deepgram');
  });

  it('includes assemblyai in provider IDs', () => {
    expect(getAiProviderIds()).toContain('assemblyai');
  });

  it('recognizes together as a valid provider ID', () => {
    expect(isValidAiProviderId('together')).toBe(true);
  });

  it('recognizes deepgram as a valid provider ID', () => {
    expect(isValidAiProviderId('deepgram')).toBe(true);
  });

  it('recognizes assemblyai as a valid provider ID', () => {
    expect(isValidAiProviderId('assemblyai')).toBe(true);
  });

  it('together has empty models (STT-only)', () => {
    const meta = getAiProviderMeta('together');
    expect(meta.models).toHaveLength(0);
    expect(meta.displayName).toBe('Together AI');
  });

  it('deepgram has empty models (STT-only)', () => {
    const meta = getAiProviderMeta('deepgram');
    expect(meta.models).toHaveLength(0);
    expect(meta.displayName).toBe('Deepgram (STT)');
  });

  it('assemblyai has empty models (STT-only)', () => {
    const meta = getAiProviderMeta('assemblyai');
    expect(meta.models).toHaveLength(0);
    expect(meta.displayName).toBe('AssemblyAI (STT)');
  });
});

describe('importEpisodeSchema — STT providers', () => {
  // Inline import to avoid pulling in all validations deps
  let importEpisodeSchema: typeof import('@/lib/validations').importEpisodeSchema;

  beforeEach(async () => {
    const mod = await import('@/lib/validations');
    importEpisodeSchema = mod.importEpisodeSchema;
  });

  it('accepts openai as sttProvider', () => {
    const result = importEpisodeSchema.safeParse({
      sourcePlatform: 'youtube',
      sttProvider: 'openai',
    });
    expect(result.success).toBe(true);
  });

  it('accepts elevenlabs as sttProvider', () => {
    const result = importEpisodeSchema.safeParse({
      sourcePlatform: 'youtube',
      sttProvider: 'elevenlabs',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid sttProvider', () => {
    const result = importEpisodeSchema.safeParse({
      sourcePlatform: 'youtube',
      sttProvider: 'invalid-provider',
    });
    expect(result.success).toBe(false);
  });

  it('accepts together as sttProvider', () => {
    const result = importEpisodeSchema.safeParse({
      sourcePlatform: 'youtube',
      sttProvider: 'together',
    });
    expect(result.success).toBe(true);
  });

  it('accepts deepgram as sttProvider', () => {
    const result = importEpisodeSchema.safeParse({
      sourcePlatform: 'youtube',
      sttProvider: 'deepgram',
    });
    expect(result.success).toBe(true);
  });

  it('accepts assemblyai as sttProvider', () => {
    const result = importEpisodeSchema.safeParse({
      sourcePlatform: 'youtube',
      sttProvider: 'assemblyai',
    });
    expect(result.success).toBe(true);
  });

  it.each(['cartesia', 'groq', 'gladia', 'speechmatics'])(
    'accepts %s as sttProvider',
    (sttProvider) => {
      const result = importEpisodeSchema.safeParse({ sourcePlatform: 'youtube', sttProvider });
      expect(result.success).toBe(true);
    }
  );

  it('accepts omitted sttProvider', () => {
    const result = importEpisodeSchema.safeParse({
      sourcePlatform: 'youtube',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sttProvider).toBeUndefined();
    }
  });
});

describe('getConfiguredSttProviderId', () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it('defaults to openai when the shared STT provider is unset', () => {
    serverConfiguration.values = {};
    expect(getConfiguredSttProviderId()).toBe('openai');
  });

  it('returns the configured local STT provider', () => {
    serverConfiguration.values = { sttProvider: 'local' };
    expect(getConfiguredSttProviderId()).toBe('local');
  });

  it('falls back to openai for an unknown shared STT provider', () => {
    serverConfiguration.values = { sttProvider: 'bogus' };
    expect(getConfiguredSttProviderId()).toBe('openai');
  });
});

describe('STT language support metadata', () => {
  it('reports model-language compatibility', () => {
    expect(supportsSttLanguage('deepgram', 'nova-2', 'es')).toBe(true);
    expect(supportsSttLanguage('deepgram', 'nova-2', 'ar')).toBe(false);
    expect(supportsSttLanguage('deepgram', 'nova-3', 'ar')).toBe(true);
    expect(supportsSttLanguage('assemblyai', 'universal-3-pro', 'de')).toBe(true);
    expect(supportsSttLanguage('assemblyai', 'universal-3-pro', 'ja')).toBe(false);
    expect(supportsSttLanguage('gladia', 'solaria-3', 'de')).toBe(true);
    expect(supportsSttLanguage('gladia', 'solaria-3', 'pt')).toBe(false);
    expect(supportsSttLanguage('speechmatics', 'enhanced', 'zh')).toBe(true);
  });

  it('chooses the strongest compatible model for a provider and language', () => {
    expect(getDefaultSttModelForLanguage('deepgram', 'ar', 'nova-2')).toBe('nova-3');
    expect(getDefaultSttModelForLanguage('assemblyai', 'ja', 'universal-3-pro')).toBe('best');
    expect(getDefaultSttModelForLanguage('gladia', 'pt', 'solaria-3')).toBe('solaria-1');
    expect(getDefaultSttModelForLanguage('deepgram', 'xx', 'nova-2')).toBeNull();
  });
});
