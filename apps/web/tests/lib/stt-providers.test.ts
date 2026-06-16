import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  createSttProvider,
  resolveSttProvider,
  getSttPlatformKey,
  getConfiguredSttProviderId,
} from '@/lib/providers/stt';
import { getDefaultSttModelForLanguage, supportsSttLanguage } from '@/lib/providers/stt-registry';
import {
  isValidAiProviderId,
  getAiProviderMeta,
  getAiProviderIds,
} from '@/lib/providers/ai-registry';

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
    vi.stubEnv('ELEVENLABS_API_KEY', 'test-key');
    const provider = createSttProvider('elevenlabs');
    expect(provider).toBeDefined();
    expect(provider.transcribe).toBeInstanceOf(Function);
  });

  it('maps Sotto language codes to ElevenLabs Scribe codes and normalizes the result', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_url, init) => {
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

  it('openai provider throws with correct error when not initialized', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const provider = createSttProvider('openai');
    await expect(provider.transcribe(Buffer.from('audio'))).rejects.toThrow(
      'OpenAI Whisper provider not initialized — set OPENAI_API_KEY'
    );
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

  it('extracts .text from object response when verbose_json fails', async () => {
    await import('openai');
    const provider = createSttProvider('together', 'tog-test');

    // First call (verbose_json) throws
    mockTranscriptionsCreate.mockRejectedValueOnce(new Error('verbose_json is not supported'));
    // Second call (text fallback) returns an object instead of a string
    mockTranscriptionsCreate.mockResolvedValueOnce({ text: 'transcribed content' });

    const result = await provider.transcribe(Buffer.from('audio'));
    expect(result.text).toBe('transcribed content');
    expect(result.segments[0].text).toBe('transcribed content');
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

  it('local provider throws without STT_BASE_URL', () => {
    vi.stubEnv('STT_BASE_URL', '');
    expect(() => createSttProvider('local', 'local')).toThrow('STT_BASE_URL is required');
  });

  it('local provider points the OpenAI SDK at STT_BASE_URL and uses STT_MODEL', async () => {
    await import('openai');
    vi.stubEnv('STT_BASE_URL', 'http://localhost:8000/v1');
    vi.stubEnv('STT_MODEL', 'whisper-large-v3-turbo');
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

  it('together validation calls correct endpoint', async () => {
    const meta = getAiProviderMeta('together');
    const mockFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const result = await meta.auth.validate({ apiKey: 'tog-test' });
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.together.xyz/v1/models',
      expect.objectContaining({
        headers: { Authorization: 'Bearer tog-test' },
      })
    );

    mockFetch.mockRestore();
  });

  it('deepgram validation uses Token auth', async () => {
    const meta = getAiProviderMeta('deepgram');
    const mockFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const result = await meta.auth.validate({ apiKey: 'dg-test' });
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.deepgram.com/v1/projects',
      expect.objectContaining({
        headers: { Authorization: 'Token dg-test' },
      })
    );

    mockFetch.mockRestore();
  });

  it('assemblyai validation uses authorization header', async () => {
    const meta = getAiProviderMeta('assemblyai');
    const mockFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const result = await meta.auth.validate({ apiKey: 'aai-test' });
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.assemblyai.com/v2/transcript?limit=1',
      expect.objectContaining({
        headers: { authorization: 'aai-test' },
      })
    );

    mockFetch.mockRestore();
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

describe('getSttPlatformKey', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns OPENAI_API_KEY for openai', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-platform');
    expect(getSttPlatformKey('openai')).toBe('sk-platform');
  });

  it('returns TOGETHER_API_KEY for together', () => {
    vi.stubEnv('TOGETHER_API_KEY', 'tog-platform');
    expect(getSttPlatformKey('together')).toBe('tog-platform');
  });

  it('returns undefined when env var is not set', () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    expect(getSttPlatformKey('openai')).toBe('');
  });

  it('returns a "local" placeholder for the keyless local provider', () => {
    vi.stubEnv('STT_API_KEY', '');
    expect(getSttPlatformKey('local')).toBe('local');
  });

  it('returns STT_API_KEY for local when the local server is behind auth', () => {
    vi.stubEnv('STT_API_KEY', 'secret-token');
    expect(getSttPlatformKey('local')).toBe('secret-token');
  });
});

describe('getConfiguredSttProviderId', () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it('defaults to openai when STT_PROVIDER is unset', () => {
    vi.stubEnv('STT_PROVIDER', '');
    expect(getConfiguredSttProviderId()).toBe('openai');
  });

  it('returns local when STT_PROVIDER=local', () => {
    vi.stubEnv('STT_PROVIDER', 'local');
    expect(getConfiguredSttProviderId()).toBe('local');
  });

  it('falls back to openai for an unknown STT_PROVIDER value', () => {
    vi.stubEnv('STT_PROVIDER', 'bogus');
    expect(getConfiguredSttProviderId()).toBe('openai');
  });
});

describe('resolveSttProvider', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mockGetAiKey.mockReset();
    mockGetByokKey.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('resolves BYOK key for requested provider', async () => {
    mockGetAiKey.mockResolvedValue({ apiKey: 'byok-openai-key', provider: 'openai' });

    const result = await resolveSttProvider({
      userId: 'user-1',
      requestedProvider: 'openai',
    });

    expect(result.providerId).toBe('openai');
    expect(result.apiKey).toBe('byok-openai-key');
    expect(result.source).toBe('byok');
    expect(result.model).toBe('whisper-1');
  });

  it('falls back to platform key when no BYOK key', async () => {
    mockGetAiKey.mockResolvedValue(null);
    vi.stubEnv('OPENAI_API_KEY', 'sk-platform');

    const result = await resolveSttProvider({
      userId: 'user-1',
      requestedProvider: 'openai',
    });

    expect(result.providerId).toBe('openai');
    expect(result.apiKey).toBe('sk-platform');
    expect(result.source).toBe('platform');
  });

  it('throws when no key available for requested provider', async () => {
    mockGetAiKey.mockResolvedValue(null);
    vi.stubEnv('DEEPGRAM_API_KEY', '');

    await expect(
      resolveSttProvider({ userId: 'user-1', requestedProvider: 'deepgram' })
    ).rejects.toThrow('No API key available for STT provider "deepgram"');
  });

  it('uses requestedModel when provided', async () => {
    mockGetAiKey.mockResolvedValue({ apiKey: 'byok-key', provider: 'openai' });

    const result = await resolveSttProvider({
      userId: 'user-1',
      requestedProvider: 'openai',
      requestedModel: 'gpt-4o-transcribe',
    });

    expect(result.model).toBe('gpt-4o-transcribe');
  });

  it('keeps a requested STT model when it supports the requested language', async () => {
    mockGetAiKey.mockResolvedValue({ apiKey: 'byok-key', provider: 'deepgram' });

    const result = await resolveSttProvider({
      userId: 'user-1',
      requestedProvider: 'deepgram',
      requestedModel: 'nova-3',
      language: 'ar',
    });

    expect(result.model).toBe('nova-3');
  });

  it('swaps to a compatible STT model when the requested model lacks the language', async () => {
    mockGetAiKey.mockResolvedValue({ apiKey: 'byok-key', provider: 'deepgram' });

    const result = await resolveSttProvider({
      userId: 'user-1',
      requestedProvider: 'deepgram',
      requestedModel: 'nova-2',
      language: 'ar',
    });

    expect(result.model).toBe('nova-3');
  });

  it('throws before provider calls when no STT model supports the language', async () => {
    mockGetAiKey.mockResolvedValue({ apiKey: 'byok-key', provider: 'deepgram' });

    await expect(
      resolveSttProvider({
        userId: 'user-1',
        requestedProvider: 'deepgram',
        requestedModel: 'nova-2',
        language: 'xx',
      })
    ).rejects.toThrow('does not support language "xx"');
  });

  it('rejects missing provider instead of resolving from DB config', async () => {
    await expect(resolveSttProvider({ userId: 'user-1' })).rejects.toThrow(
      'STT provider is required'
    );
    expect(mockGetAiKey).not.toHaveBeenCalled();
  });

  it('resolves elevenlabs via shared BYOK lookup', async () => {
    mockGetByokKey.mockResolvedValue('el-byok-key');

    const result = await resolveSttProvider({
      userId: 'user-1',
      requestedProvider: 'elevenlabs',
    });

    expect(result.providerId).toBe('elevenlabs');
    expect(result.apiKey).toBe('el-byok-key');
    expect(result.source).toBe('byok');
    expect(mockGetByokKey).toHaveBeenCalledWith('user-1', 'elevenlabs');
  });

  it('resolves cartesia via getByokKey (key lives in the TTS store)', async () => {
    mockGetByokKey.mockResolvedValue('car-byok-key');

    const result = await resolveSttProvider({
      userId: 'user-1',
      requestedProvider: 'cartesia',
    });

    expect(result.providerId).toBe('cartesia');
    expect(result.apiKey).toBe('car-byok-key');
    expect(result.source).toBe('byok');
    expect(result.model).toBe('ink-whisper');
    expect(mockGetByokKey).toHaveBeenCalledWith('user-1', 'cartesia');
  });

  it('resolves groq via the AI-key store', async () => {
    mockGetAiKey.mockResolvedValue({ apiKey: 'gsk-byok', provider: 'groq' });

    const result = await resolveSttProvider({
      userId: 'user-1',
      requestedProvider: 'groq',
    });

    expect(result.providerId).toBe('groq');
    expect(result.apiKey).toBe('gsk-byok');
    expect(result.model).toBe('whisper-large-v3-turbo');
    expect(mockGetAiKey).toHaveBeenCalledWith('user-1', 'groq');
  });

  it('resolves the keyless local provider with a placeholder key (no cloud key needed)', async () => {
    mockGetAiKey.mockResolvedValue(null);
    vi.stubEnv('STT_API_KEY', '');

    const result = await resolveSttProvider({
      userId: 'user-1',
      requestedProvider: 'local',
    });

    expect(result.providerId).toBe('local');
    expect(result.apiKey).toBe('local');
    expect(result.source).toBe('platform');
    expect(result.model).toBe('whisper-1');
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
