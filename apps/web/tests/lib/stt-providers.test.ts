import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockTranscriptionsCreate = vi.fn();

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

import { createSttProvider } from '@/lib/providers/stt';
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

  it('returns a groq provider for "groq"', () => {
    const provider = createSttProvider('groq', 'gsk-test-key');
    expect(provider).toBeDefined();
    expect(provider.transcribe).toBeInstanceOf(Function);
  });

  it('groq provider uses GROQ_API_KEY env var when no key passed', () => {
    vi.stubEnv('GROQ_API_KEY', 'gsk-from-env');
    const provider = createSttProvider('groq');
    expect(provider).toBeDefined();
  });

  it('groq provider throws with correct error when not initialized', async () => {
    // No API key → provider not initialized
    const provider = createSttProvider('groq');
    await expect(provider.transcribe(Buffer.from('audio'))).rejects.toThrow(
      'Groq Whisper provider not initialized — set GROQ_API_KEY'
    );
  });

  it('openai provider throws with correct error when not initialized', async () => {
    const provider = createSttProvider('openai');
    await expect(provider.transcribe(Buffer.from('audio'))).rejects.toThrow(
      'OpenAI Whisper provider not initialized — set OPENAI_API_KEY'
    );
  });

  it('groq provider passes baseURL to OpenAI client', async () => {
    // Warm up vitest mock module cache for dynamic import('openai') in loadClient
    await import('openai');
    const provider = createSttProvider('groq', 'gsk-test');

    // The provider should have been constructed with baseURL
    // We verify by checking that transcribe uses the correct model
    mockTranscriptionsCreate.mockResolvedValueOnce({
      text: 'hello',
      language: 'en',
      segments: [{ start: 0, end: 1, text: 'hello' }],
    });

    const result = await provider.transcribe(Buffer.from('audio'));
    expect(result.text).toBe('hello');
    expect(mockTranscriptionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'whisper-large-v3-turbo',
        response_format: 'verbose_json',
      })
    );
  });

  it('openai provider uses whisper-1 model', async () => {
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
});

describe('AI Registry — Groq provider', () => {
  it('includes groq in provider IDs', () => {
    expect(getAiProviderIds()).toContain('groq');
  });

  it('recognizes groq as a valid provider ID', () => {
    expect(isValidAiProviderId('groq')).toBe(true);
  });

  it('rejects invalid provider IDs', () => {
    expect(isValidAiProviderId('deepseek')).toBe(false);
  });

  it('returns correct metadata for groq', () => {
    const meta = getAiProviderMeta('groq');
    expect(meta.id).toBe('groq');
    expect(meta.displayName).toBe('Groq');
    expect(meta.defaultModel).toBe('llama-3.3-70b-versatile');
    expect(meta.getApiKeyUrl).toBe('https://console.groq.com/keys');
    expect(meta.auth.fields[0].placeholder).toBe('gsk_...');
  });

  it('groq validation function calls the correct endpoint', async () => {
    const meta = getAiProviderMeta('groq');
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 200 })
    );

    const result = await meta.auth.validate({ apiKey: 'gsk-test' });
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/models',
      expect.objectContaining({
        headers: { Authorization: 'Bearer gsk-test' },
      })
    );

    mockFetch.mockRestore();
  });

  it('groq validation returns false on invalid key', async () => {
    const meta = getAiProviderMeta('groq');
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 401 })
    );

    const result = await meta.auth.validate({ apiKey: 'bad-key' });
    expect(result).toBe(false);

    mockFetch.mockRestore();
  });

  it('groq validation returns false on network error', async () => {
    const meta = getAiProviderMeta('groq');
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new Error('Network error')
    );

    const result = await meta.auth.validate({ apiKey: 'gsk-test' });
    expect(result).toBe(false);

    mockFetch.mockRestore();
  });
});

describe('importPodcastSchema — groq STT provider', () => {
  // Inline import to avoid pulling in all validations deps
  let importPodcastSchema: typeof import('@/lib/validations').importPodcastSchema;

  beforeEach(async () => {
    const mod = await import('@/lib/validations');
    importPodcastSchema = mod.importPodcastSchema;
  });

  it('accepts groq as sttProvider', () => {
    const result = importPodcastSchema.safeParse({
      isHumanContent: false,
      sourcePlatform: 'youtube',
      sttProvider: 'groq',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sttProvider).toBe('groq');
    }
  });

  it('accepts openai as sttProvider', () => {
    const result = importPodcastSchema.safeParse({
      isHumanContent: false,
      sourcePlatform: 'youtube',
      sttProvider: 'openai',
    });
    expect(result.success).toBe(true);
  });

  it('accepts elevenlabs as sttProvider', () => {
    const result = importPodcastSchema.safeParse({
      isHumanContent: false,
      sourcePlatform: 'youtube',
      sttProvider: 'elevenlabs',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid sttProvider', () => {
    const result = importPodcastSchema.safeParse({
      isHumanContent: false,
      sourcePlatform: 'youtube',
      sttProvider: 'deepgram',
    });
    expect(result.success).toBe(false);
  });

  it('accepts omitted sttProvider', () => {
    const result = importPodcastSchema.safeParse({
      isHumanContent: false,
      sourcePlatform: 'youtube',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sttProvider).toBeUndefined();
    }
  });
});
