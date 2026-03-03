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
    expect(() => createSttProvider('deepgram')).toThrow(
      'No Deepgram API key provided'
    );
  });

  it('returns an assemblyai provider for "assemblyai"', () => {
    const provider = createSttProvider('assemblyai', 'aai-test-key');
    expect(provider).toBeDefined();
    expect(provider.transcribe).toBeInstanceOf(Function);
  });

  it('assemblyai provider throws without API key', () => {
    vi.stubEnv('ASSEMBLYAI_API_KEY', '');
    expect(() => createSttProvider('assemblyai')).toThrow(
      'No AssemblyAI API key provided'
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
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 200 })
    );

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
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 200 })
    );

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
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 200 })
    );

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

describe('importPodcastSchema — STT providers', () => {
  // Inline import to avoid pulling in all validations deps
  let importPodcastSchema: typeof import('@/lib/validations').importPodcastSchema;

  beforeEach(async () => {
    const mod = await import('@/lib/validations');
    importPodcastSchema = mod.importPodcastSchema;
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
      sttProvider: 'invalid-provider',
    });
    expect(result.success).toBe(false);
  });

  it('accepts together as sttProvider', () => {
    const result = importPodcastSchema.safeParse({
      isHumanContent: false,
      sourcePlatform: 'youtube',
      sttProvider: 'together',
    });
    expect(result.success).toBe(true);
  });

  it('accepts deepgram as sttProvider', () => {
    const result = importPodcastSchema.safeParse({
      isHumanContent: false,
      sourcePlatform: 'youtube',
      sttProvider: 'deepgram',
    });
    expect(result.success).toBe(true);
  });

  it('accepts assemblyai as sttProvider', () => {
    const result = importPodcastSchema.safeParse({
      isHumanContent: false,
      sourcePlatform: 'youtube',
      sttProvider: 'assemblyai',
    });
    expect(result.success).toBe(true);
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
