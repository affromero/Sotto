import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockSemaphoreAcquire = vi.fn().mockResolvedValue(true);
const mockSemaphoreRelease = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/redis', () => ({
  semaphore: {
    acquire: (...args: unknown[]) => mockSemaphoreAcquire(...args),
    release: (...args: unknown[]) => mockSemaphoreRelease(...args),
  },
}));

vi.mock('@/lib/byok', () => ({
  getByokKey: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/elevenlabs', () => ({
  getElevenLabsConcurrencyLimit: vi.fn().mockResolvedValue(5),
}));

vi.mock('@/lib/providers/tts/cartesia.provider', () => ({
  getCartesiaConcurrencyLimit: vi.fn().mockResolvedValue(2),
  updateCartesiaConcurrencyFromError: vi.fn(),
}));

vi.mock('@/lib/providers/tts/hume.provider', () => ({
  getHumeConcurrencyLimit: vi.fn().mockResolvedValue(5),
  updateHumeConcurrencyFromError: vi.fn(),
}));

vi.mock('@/lib/tts-text-cleaner', () => ({
  cleanTextForTts: vi.fn((text: string) => text),
  splitTextForTts: vi.fn((text: string) => [text]),
}));

const mockGetAudioDuration = vi.fn().mockResolvedValue(5.0);

vi.mock('@/lib/audio-stitcher', () => ({
  getAudioDuration: (...args: unknown[]) => mockGetAudioDuration(...args),
}));

vi.mock('fs/promises', () => {
  const writeFile = vi.fn().mockResolvedValue(undefined);
  const rm = vi.fn().mockResolvedValue(undefined);
  const readFile = vi.fn().mockResolvedValue(Buffer.from('concatenated-audio'));
  return { default: { writeFile, rm, readFile }, writeFile, rm, readFile };
});

vi.mock('child_process', () => {
  const execFile = vi.fn((_cmd: string, _args: string[], cb: (err: null, stdout: string, stderr: string) => void) => {
    cb(null, '', '');
  });
  return { default: { execFile }, execFile };
});

vi.mock('@/lib/duration', () => ({
  estimateDurationFromText: vi.fn((text: string) => text.length / 12.5),
}));

vi.mock('@/lib/providers/tts-registry', () => ({
  getProviderMeta: vi.fn().mockReturnValue({
    id: 'elevenlabs',
    displayName: 'ElevenLabs',
    platformCostPerKChar: 0.3,
    maxSegmentChars: 5000,
    modelsWithoutTextContext: ['eleven_v3'],
  }),
}));

const mockLogUsage = vi.fn();
vi.mock('@/lib/usage-logger', () => ({
  logUsage: (...args: unknown[]) => mockLogUsage(...args),
}));

vi.mock('@/lib/byok-errors', () => ({
  isModelAccessError: vi.fn((msg: string) => /\b404\b/.test(msg)),
}));

const mockResolveTtsProvider = vi.fn();
vi.mock('@/lib/providers/tts', () => ({
  resolveTtsProvider: (...args: unknown[]) => mockResolveTtsProvider(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---- Import under test ----
import { generateTtsAudio, getPlatformTtsKey, type TtsGenerationParams } from '@/lib/tts-generation';
import { splitTextForTts } from '@/lib/tts-text-cleaner';
import { getElevenLabsConcurrencyLimit } from '@/lib/elevenlabs';
import { getCartesiaConcurrencyLimit, updateCartesiaConcurrencyFromError } from '@/lib/providers/tts/cartesia.provider';
import { updateHumeConcurrencyFromError } from '@/lib/providers/tts/hume.provider';
import type { TtsProviderId } from '@/lib/providers/tts-registry';

// ---- Helpers ----

const mockGenerateSpeech = vi.fn().mockResolvedValue(Buffer.from('audio-data'));

function defaultParams(overrides?: Partial<TtsGenerationParams>): TtsGenerationParams {
  return {
    text: 'Hello world',
    voiceId: 'voice-1',
    speaker: 'HOST',
    provider: {
      generateSpeech: (...args: unknown[]) => mockGenerateSpeech(...args),
      getVoiceId: vi.fn().mockReturnValue('voice-1'),
      getModelId: () => 'eleven_v3',
      providerId: 'elevenlabs' as TtsProviderId,
    },
    providerId: 'elevenlabs',
    source: 'platform',
    userId: 'user-1',
    podcastId: 'podcast-1',
    plan: 'FREE',
    usageCategory: 'audio_generation',
    isAborted: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

// ---- Tests ----

describe('generateTtsAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSemaphoreAcquire.mockResolvedValue(true);
    mockGenerateSpeech.mockResolvedValue(Buffer.from('audio-data'));
    mockGetAudioDuration.mockResolvedValue(5.0);
  });

  it('generates audio and returns buffer with duration', async () => {
    const result = await generateTtsAudio(defaultParams());

    expect(result).not.toBeNull();
    expect(result!.audioBuffer).toEqual(Buffer.from('audio-data'));
    expect(result!.segmentDuration).toBe(5.0);
    expect(result!.service).toBe('elevenlabs');
  });

  it('passes all speech params to provider.generateSpeech', async () => {
    await generateTtsAudio(defaultParams({
      text: 'Test segment',
      voiceId: 'voice-42',
      previousText: 'Previous text',
      nextText: 'Next text',
      direction: 'enthusiastic',
      speaker: 'EXPERT',
    }));

    expect(mockGenerateSpeech).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Test segment',
        voiceId: 'voice-42',
        previousText: 'Previous text',
        nextText: 'Next text',
        direction: 'enthusiastic',
        speaker: 'EXPERT',
      })
    );
  });

  it('acquires and releases semaphore', async () => {
    await generateTtsAudio(defaultParams());

    expect(mockSemaphoreAcquire).toHaveBeenCalledWith('tts:sem:user-1:elevenlabs', 5);
    expect(mockSemaphoreRelease).toHaveBeenCalledWith('tts:sem:user-1:elevenlabs');
  });

  it('returns null when isAborted returns true during semaphore wait', async () => {
    // Semaphore never acquired — triggers abort check
    mockSemaphoreAcquire.mockResolvedValue(false);
    const isAborted = vi.fn().mockResolvedValue(true);

    const result = await generateTtsAudio(defaultParams({ isAborted }));

    expect(result).toBeNull();
    expect(mockGenerateSpeech).not.toHaveBeenCalled();
  });

  it('throws when semaphore times out after 30 attempts', async () => {
    vi.useFakeTimers();
    mockSemaphoreAcquire.mockResolvedValue(false);
    const isAborted = vi.fn().mockResolvedValue(false);

    const promise = generateTtsAudio(defaultParams({ isAborted })).catch((e: Error) => e);

    // Advance through all 30 backoff iterations
    for (let i = 0; i < 30; i++) {
      await vi.advanceTimersByTimeAsync(16000);
    }

    const error = await promise;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch('Timed out waiting for TTS semaphore');
    vi.useRealTimers();
  });

  it('uses ElevenLabs concurrency limit when provider is elevenlabs', async () => {
    process.env.ELEVENLABS_API_KEY = 'test-key';
    (getElevenLabsConcurrencyLimit as ReturnType<typeof vi.fn>).mockResolvedValue(10);

    await generateTtsAudio(defaultParams());

    expect(getElevenLabsConcurrencyLimit).toHaveBeenCalledWith('test-key');
    expect(mockSemaphoreAcquire).toHaveBeenCalledWith('tts:sem:user-1:elevenlabs', 10);

    delete process.env.ELEVENLABS_API_KEY;
  });

  it('uses Cartesia concurrency limit when provider is cartesia', async () => {
    process.env.CARTESIA_API_KEY = 'cartesia-key';

    await generateTtsAudio(defaultParams({ providerId: 'cartesia' }));

    expect(getCartesiaConcurrencyLimit).toHaveBeenCalledWith('cartesia-key');

    delete process.env.CARTESIA_API_KEY;
  });

  it('returns byok service string when source is byok', async () => {
    const result = await generateTtsAudio(defaultParams({ source: 'byok' }));

    expect(result!.service).toBe('elevenlabs_byok');
  });

  it('falls back to text estimation when FFprobe fails', async () => {
    mockGetAudioDuration.mockRejectedValue(new Error('FFprobe not found'));

    const result = await generateTtsAudio(defaultParams({ text: 'A'.repeat(125) }));

    // 125 chars / 12.5 chars/sec = 10 sec
    expect(result!.segmentDuration).toBe(10);
  });

  it('logs usage with correct category and metadata', async () => {
    await generateTtsAudio(defaultParams({
      usageCategory: 'voice_track_audio',
      extraMetadata: { voiceTrackId: 'vt-1' },
    }));

    expect(mockLogUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'voice_track_audio',
        podcastId: 'podcast-1',
        userId: 'user-1',
        metadata: expect.objectContaining({ voiceTrackId: 'vt-1' }),
      })
    );
  });

  it('throws on BYOK model-access 404 — no retry', async () => {
    mockGenerateSpeech.mockRejectedValue(
      new Error('ElevenLabs API error (404): The model does not exist')
    );

    await expect(
      generateTtsAudio(defaultParams({ source: 'byok' }))
    ).rejects.toThrow('(404)');

    expect(mockResolveTtsProvider).not.toHaveBeenCalled();
  });

  describe('429 error handling', () => {
    it('updates Cartesia concurrency on 429', async () => {
      process.env.CARTESIA_API_KEY = 'cartesia-key';
      const cartesiaSpeech = vi.fn().mockRejectedValue(
        new Error('Cartesia API error (429): Rate limited. Current limit: 3')
      );

      await expect(
        generateTtsAudio(defaultParams({
          providerId: 'cartesia',
          provider: {
            generateSpeech: (...args: unknown[]) => cartesiaSpeech(...args),
            getVoiceId: vi.fn(),
            getModelId: () => 'sonic-3',
            providerId: 'cartesia' as TtsProviderId,
          },
        }))
      ).rejects.toThrow('(429)');

      expect(updateCartesiaConcurrencyFromError).toHaveBeenCalledWith(
        'cartesia-key',
        'Cartesia API error (429): Rate limited. Current limit: 3'
      );
      expect(mockSemaphoreRelease).toHaveBeenCalled();

      delete process.env.CARTESIA_API_KEY;
    });

    it('updates Hume concurrency on 429', async () => {
      process.env.HUME_API_KEY = 'hume-key';
      const humeSpeech = vi.fn().mockRejectedValue(
        new Error('Hume AI API error (429): concurrency limit exceeded')
      );

      await expect(
        generateTtsAudio(defaultParams({
          providerId: 'hume',
          provider: {
            generateSpeech: (...args: unknown[]) => humeSpeech(...args),
            getVoiceId: vi.fn(),
            getModelId: () => 'octave-v1',
            providerId: 'hume' as TtsProviderId,
          },
        }))
      ).rejects.toThrow('(429)');

      expect(updateHumeConcurrencyFromError).toHaveBeenCalledWith(
        'hume-key',
        'Hume AI API error (429): concurrency limit exceeded'
      );

      delete process.env.HUME_API_KEY;
    });

    it('does not update concurrency on non-429 errors', async () => {
      mockGenerateSpeech.mockRejectedValue(new Error('ElevenLabs API error (500): Internal'));

      await expect(generateTtsAudio(defaultParams())).rejects.toThrow('(500)');

      expect(updateCartesiaConcurrencyFromError).not.toHaveBeenCalled();
      expect(updateHumeConcurrencyFromError).not.toHaveBeenCalled();
    });

    it('releases semaphore on error', async () => {
      mockGenerateSpeech.mockRejectedValue(new Error('TTS failed'));

      await expect(generateTtsAudio(defaultParams())).rejects.toThrow('TTS failed');

      expect(mockSemaphoreRelease).toHaveBeenCalled();
    });
  });

  describe('multi-chunk generation', () => {
    it('skips text context for v3 model and passes continuityIds between chunks', async () => {
      const chunk1 = 'First chunk of text.';
      const chunk2 = 'Second chunk of text.';
      (splitTextForTts as ReturnType<typeof vi.fn>).mockReturnValue([chunk1, chunk2]);

      // Provider returns continuity IDs via getLastContinuityId
      let callCount = 0;
      const mockGetLastContinuityId = vi.fn(() => {
        callCount++;
        return `req-${callCount}`;
      });

      mockGenerateSpeech
        .mockResolvedValueOnce(Buffer.from('audio-chunk-1'))
        .mockResolvedValueOnce(Buffer.from('audio-chunk-2'));

      const result = await generateTtsAudio(defaultParams({
        text: `${chunk1} ${chunk2}`,
        previousText: 'Before segment.',
        nextText: 'After segment.',
        provider: {
          generateSpeech: (...args: unknown[]) => mockGenerateSpeech(...args),
          getVoiceId: vi.fn().mockReturnValue('voice-1'),
          getModelId: () => 'eleven_v3',
          getLastContinuityId: mockGetLastContinuityId,
          providerId: 'elevenlabs' as TtsProviderId,
        },
      }));

      expect(result).not.toBeNull();
      expect(mockGenerateSpeech).toHaveBeenCalledTimes(2);

      // eleven_v3 is in modelsWithoutTextContext — text context should be undefined
      expect(mockGenerateSpeech).toHaveBeenNthCalledWith(1, expect.objectContaining({
        text: chunk1,
        previousText: undefined,
        nextText: undefined,
      }));

      // Second chunk gets continuityIds from the first chunk
      expect(mockGenerateSpeech).toHaveBeenNthCalledWith(2, expect.objectContaining({
        text: chunk2,
        previousText: undefined,
        nextText: undefined,
        continuityIds: ['req-1'],
      }));

      expect(result!.audioBuffer).toEqual(Buffer.from('concatenated-audio'));
    });

    it('passes text context for non-v3 models', async () => {
      const chunk1 = 'First chunk of text.';
      const chunk2 = 'Second chunk of text.';
      (splitTextForTts as ReturnType<typeof vi.fn>).mockReturnValue([chunk1, chunk2]);

      mockGenerateSpeech
        .mockResolvedValueOnce(Buffer.from('audio-chunk-1'))
        .mockResolvedValueOnce(Buffer.from('audio-chunk-2'));

      const result = await generateTtsAudio(defaultParams({
        text: `${chunk1} ${chunk2}`,
        previousText: 'Before segment.',
        nextText: 'After segment.',
        provider: {
          generateSpeech: (...args: unknown[]) => mockGenerateSpeech(...args),
          getVoiceId: vi.fn().mockReturnValue('voice-1'),
          getModelId: () => 'eleven_turbo_v2',
          providerId: 'elevenlabs' as TtsProviderId,
        },
      }));

      expect(result).not.toBeNull();
      expect(mockGenerateSpeech).toHaveBeenCalledTimes(2);

      // Non-v3 model keeps text context bridging
      expect(mockGenerateSpeech).toHaveBeenNthCalledWith(1, expect.objectContaining({
        text: chunk1,
        previousText: 'Before segment.',
        nextText: chunk2.slice(0, 500),
      }));

      expect(mockGenerateSpeech).toHaveBeenNthCalledWith(2, expect.objectContaining({
        text: chunk2,
        previousText: chunk1.slice(-500),
        nextText: 'After segment.',
      }));

      expect(result!.audioBuffer).toEqual(Buffer.from('concatenated-audio'));
    });

    it('single chunk takes fast path without FFmpeg concat', async () => {
      (splitTextForTts as ReturnType<typeof vi.fn>).mockReturnValue(['Single chunk.']);
      mockGenerateSpeech.mockResolvedValue(Buffer.from('single-audio'));

      const result = await generateTtsAudio(defaultParams({ text: 'Single chunk.' }));

      expect(result).not.toBeNull();
      expect(mockGenerateSpeech).toHaveBeenCalledTimes(1);
      expect(result!.audioBuffer).toEqual(Buffer.from('single-audio'));
    });
  });
});

describe('getPlatformTtsKey', () => {
  it('returns ELEVENLABS_API_KEY for elevenlabs', () => {
    process.env.ELEVENLABS_API_KEY = 'el-key';
    expect(getPlatformTtsKey('elevenlabs')).toBe('el-key');
    delete process.env.ELEVENLABS_API_KEY;
  });

  it('returns OPENAI_API_KEY for openai', () => {
    process.env.OPENAI_API_KEY = 'openai-key';
    expect(getPlatformTtsKey('openai')).toBe('openai-key');
    delete process.env.OPENAI_API_KEY;
  });

  it('returns undefined for kittentts', () => {
    expect(getPlatformTtsKey('kittentts')).toBeUndefined();
  });

  it('returns FAL_KEY for fal', () => {
    process.env.FAL_KEY = 'fal-key';
    expect(getPlatformTtsKey('fal')).toBe('fal-key');
    delete process.env.FAL_KEY;
  });

  it('returns FAL_KEY for minimax', () => {
    process.env.FAL_KEY = 'fal-key';
    expect(getPlatformTtsKey('minimax')).toBe('fal-key');
    delete process.env.FAL_KEY;
  });
});
