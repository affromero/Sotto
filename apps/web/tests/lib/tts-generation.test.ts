import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, rm } from 'node:fs/promises';

let chunkAudio: Buffer;
beforeAll(async () => {
  const result = await promisify(execFile)(
    'ffmpeg',
    ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '0.2', '-f', 'mp3', 'pipe:1'],
    { encoding: 'buffer' }
  );
  chunkAudio = result.stdout;
});

// ---- Mocks ----

const mockSemaphoreWait = vi.fn().mockResolvedValue(true);
const mockSemaphoreRelease = vi.fn().mockResolvedValue(undefined);
const mockOpenSottoSemaphore = vi.fn().mockImplementation(async () => ({
  wait: (...args: unknown[]) => mockSemaphoreWait(...args),
  release: (...args: unknown[]) => mockSemaphoreRelease(...args),
}));

vi.mock('@/lib/sidedoor/jobs/core/redis-semaphore', () => ({
  openSottoSemaphore: (...args: unknown[]) => mockOpenSottoSemaphore(...args),
}));

vi.mock('@/lib/tts-text-cleaner', () => ({
  cleanTextForTts: vi.fn((text: string) => text),
  splitTextForTts: vi.fn((text: string) => [text]),
}));

const mockGetAudioDuration = vi.fn().mockResolvedValue(5.0);

vi.mock('@/lib/audio-stitcher', () => ({
  getAudioDuration: (...args: unknown[]) => mockGetAudioDuration(...args),
}));

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

const mockResolveTtsProvider = vi.fn();
vi.mock('@/lib/providers/tts', () => ({
  resolveTtsProvider: (...args: unknown[]) => mockResolveTtsProvider(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---- Import under test ----
import { generateTtsAudio, type TtsGenerationParams } from '@/lib/tts-generation';
import { splitTextForTts } from '@/lib/tts-text-cleaner';
import type { TtsProviderId } from '@/lib/providers/tts-registry';
import { MediaCleanupError } from '@/lib/audio/media-process';
import { TtsMediaCleanupError } from '@/lib/audio/tts-media';

// ---- Helpers ----

const mockGetConcurrencyLimit = vi.fn().mockResolvedValue(5);
const mockObserveConcurrencyError = vi.fn().mockResolvedValue(undefined);

const mockGenerateSpeech = vi.fn().mockResolvedValue(Buffer.from('audio-data'));

function defaultParams(overrides?: Partial<TtsGenerationParams>): TtsGenerationParams {
  return {
    text: 'Hello world',
    voiceId: 'voice-1',
    speaker: 'HOST',
    provider: {
      getConcurrencyLimit: mockGetConcurrencyLimit,
      observeConcurrencyError: mockObserveConcurrencyError,
      generateSpeech: (...args: unknown[]) => mockGenerateSpeech(...args),
      getVoiceId: vi.fn().mockReturnValue('voice-1'),
      getModelId: () => 'eleven_v3',
      providerId: 'elevenlabs' as TtsProviderId,
    },
    providerId: 'elevenlabs',
    source: 'credential',
    userId: 'user-1',
    episodeId: 'episode-1',
    usageCategory: 'audio_generation',
    isAborted: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

// ---- Tests ----

describe('generateTtsAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConcurrencyLimit.mockResolvedValue(5);
    mockObserveConcurrencyError.mockResolvedValue(undefined);
    mockSemaphoreWait.mockResolvedValue(true);
    mockSemaphoreRelease.mockResolvedValue(undefined);
    mockGenerateSpeech.mockResolvedValue(Buffer.from('audio-data'));
    mockGetAudioDuration.mockResolvedValue(5.0);
  });

  it('generates audio and returns buffer with duration', async () => {
    const result = await generateTtsAudio(defaultParams());

    expect(result).not.toBeNull();
    expect(result!.audioBuffer).toEqual(Buffer.from('audio-data'));
    expect(result!.segmentDuration).toBe(5.0);
    expect(result!.service).toBe('elevenlabs');
    expect(result!.wordTimings).toBeNull();
  });

  it('makes the provider slot available before local duration processing', async () => {
    let occupied = 0;
    mockSemaphoreWait.mockImplementation(async () => {
      occupied += 1;
      return true;
    });
    mockSemaphoreRelease.mockImplementation(async () => {
      occupied -= 1;
    });
    mockGetAudioDuration.mockImplementation(async () => {
      expect(occupied).toBe(0);
      return 5;
    });
    expect((await generateTtsAudio(defaultParams()))?.segmentDuration).toBe(5);
  });

  it('preserves provider failure and releases an acquired slot only once when Redis loses the release acknowledgement', async () => {
    const providerFailure = new Error('Provider failed');
    const releaseFailure = new Error('Redis response lost');
    let occupied = 1;
    mockGenerateSpeech.mockRejectedValue(providerFailure);
    mockSemaphoreRelease.mockImplementation(async () => {
      occupied -= 1;
      throw releaseFailure;
    });
    const error = await generateTtsAudio(defaultParams()).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([providerFailure, releaseFailure]);
    expect(occupied).toBe(0);
  });

  it('does not dispatch speech when shared admission returns cancellation', async () => {
    const controller = new AbortController();
    const cancellation = new Error('Cancelled during acquisition');
    mockSemaphoreWait.mockImplementation(async () => {
      controller.abort(cancellation);
      throw cancellation;
    });
    await expect(generateTtsAudio(defaultParams({ signal: controller.signal }))).rejects.toBe(
      cancellation
    );
    expect(mockSemaphoreRelease).not.toHaveBeenCalled();
    expect(mockGenerateSpeech).not.toHaveBeenCalled();
  });

  it('passes all speech params to provider.generateSpeech', async () => {
    await generateTtsAudio(
      defaultParams({
        text: 'Test segment',
        voiceId: 'voice-42',
        previousText: 'Previous text',
        nextText: 'Next text',
        direction: 'enthusiastic',
        speaker: 'EXPERT',
      })
    );

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

    expect(mockOpenSottoSemaphore).toHaveBeenCalledWith({
      resource: 'tts:sem:user-1:elevenlabs',
      limit: 5,
      ttlMs: 120_000,
    });
    expect(mockSemaphoreWait).toHaveBeenCalledOnce();
    const waitOptions = mockSemaphoreWait.mock.calls[0][0] as { delaysMs: number[] };
    expect(waitOptions.delaysMs).toHaveLength(29);
    expect(waitOptions.delaysMs.every(Number.isSafeInteger)).toBe(true);
    expect(mockSemaphoreRelease).toHaveBeenCalledWith();
  });

  it('returns null when isAborted returns true during semaphore wait', async () => {
    const isAborted = vi.fn().mockResolvedValue(true);
    mockSemaphoreWait.mockImplementation(
      async ({ shouldStop }: { shouldStop: () => Promise<boolean> }) => {
        await shouldStop();
        return false;
      }
    );

    const result = await generateTtsAudio(defaultParams({ isAborted }));

    expect(result).toBeNull();
    expect(mockGenerateSpeech).not.toHaveBeenCalled();
  });

  it('throws when semaphore times out after 30 attempts', async () => {
    mockSemaphoreWait.mockResolvedValue(false);
    const isAborted = vi.fn().mockResolvedValue(false);

    const error = await generateTtsAudio(defaultParams({ isAborted })).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch('Timed out waiting for TTS semaphore');
  });

  it('uses ElevenLabs concurrency limit when provider is elevenlabs', async () => {
    mockGetConcurrencyLimit.mockResolvedValue(10);

    await generateTtsAudio(defaultParams());

    expect(mockOpenSottoSemaphore).toHaveBeenCalledWith({
      resource: 'tts:sem:user-1:elevenlabs',
      limit: 10,
      ttlMs: 120_000,
    });
  });

  it('uses Cartesia concurrency limit when provider is cartesia', async () => {
    mockGetConcurrencyLimit.mockResolvedValue(2);
    await generateTtsAudio(defaultParams({ providerId: 'cartesia' }));

    expect(mockOpenSottoSemaphore).toHaveBeenCalledWith({
      resource: 'tts:sem:user-1:cartesia',
      limit: 2,
      ttlMs: 120_000,
    });
  });

  it('records the provider as the usage service for saved credentials', async () => {
    const result = await generateTtsAudio(defaultParams({ source: 'credential' }));

    expect(result!.service).toBe('elevenlabs');
  });

  it('falls back to text estimation when FFprobe fails', async () => {
    mockGetAudioDuration.mockRejectedValue(new Error('FFprobe not found'));

    const result = await generateTtsAudio(defaultParams({ text: 'A'.repeat(125) }));

    // 125 chars / 12.5 chars/sec = 10 sec
    expect(result!.segmentDuration).toBe(10);
  });

  it('does not turn duration cancellation into successful estimated audio', async () => {
    const controller = new AbortController();
    const cancellation = new Error('Stop duration processing');
    mockGetAudioDuration.mockImplementation(async () => {
      controller.abort(cancellation);
      throw cancellation;
    });
    await expect(generateTtsAudio(defaultParams({ signal: controller.signal }))).rejects.toBe(
      cancellation
    );
    expect(mockLogUsage).not.toHaveBeenCalled();
  });

  it('does not hide unconfirmed duration process cleanup behind an estimate', async () => {
    const failure = new MediaCleanupError({ cause: new Error('Process closure unconfirmed') });
    mockGetAudioDuration.mockRejectedValue(failure);
    const error = await generateTtsAudio(defaultParams()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TtsMediaCleanupError);
    const cleanup = error as TtsMediaCleanupError;
    try {
      expect(cleanup.cause).toBe(failure);
      await expect(access(cleanup.directory)).resolves.toBeUndefined();
    } finally {
      await rm(cleanup.directory, { recursive: true, force: true });
    }
    expect(mockLogUsage).not.toHaveBeenCalled();
  });

  it('logs usage with correct category and metadata', async () => {
    await generateTtsAudio(
      defaultParams({
        usageCategory: 'audio_generation',
        extraMetadata: { segmentId: 'seg-1' },
      })
    );

    expect(mockLogUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'audio_generation',
        episodeId: 'episode-1',
        userId: 'user-1',
        metadata: expect.objectContaining({ segmentId: 'seg-1' }),
      })
    );
  });

  it('surfaces a saved-credential model-access 404 without retrying', async () => {
    mockGenerateSpeech.mockRejectedValue(
      new Error('ElevenLabs API error (404): The model does not exist')
    );

    await expect(generateTtsAudio(defaultParams({ source: 'credential' }))).rejects.toThrow(
      '(404)'
    );

    expect(mockResolveTtsProvider).not.toHaveBeenCalled();
  });

  describe('429 error handling', () => {
    it('preserves the provider failure when concurrency observation fails', async () => {
      const failure = new Error('Provider API error (429): retry later');
      mockGenerateSpeech.mockRejectedValue(failure);
      mockObserveConcurrencyError.mockRejectedValue(new Error('Cache unavailable'));
      await expect(generateTtsAudio(defaultParams())).rejects.toBe(failure);
    });
    it('updates Cartesia concurrency on 429', async () => {
      const cartesiaSpeech = vi
        .fn()
        .mockRejectedValue(new Error('Cartesia API error (429): Rate limited. Current limit: 3'));

      await expect(
        generateTtsAudio(
          defaultParams({
            providerId: 'cartesia',
            provider: {
              observeConcurrencyError: mockObserveConcurrencyError,
              generateSpeech: (...args: unknown[]) => cartesiaSpeech(...args),
              getVoiceId: vi.fn(),
              getModelId: () => 'sonic-3',
              providerId: 'cartesia' as TtsProviderId,
            },
          })
        )
      ).rejects.toThrow('(429)');

      expect(mockObserveConcurrencyError).toHaveBeenCalledWith(
        'Cartesia API error (429): Rate limited. Current limit: 3',
        undefined
      );
      expect(mockSemaphoreRelease).toHaveBeenCalled();
    });

    it('updates Hume concurrency on 429', async () => {
      const humeSpeech = vi
        .fn()
        .mockRejectedValue(new Error('Hume AI API error (429): concurrency limit exceeded'));

      await expect(
        generateTtsAudio(
          defaultParams({
            providerId: 'hume',
            provider: {
              observeConcurrencyError: mockObserveConcurrencyError,
              generateSpeech: (...args: unknown[]) => humeSpeech(...args),
              getVoiceId: vi.fn(),
              getModelId: () => 'octave-v1',
              providerId: 'hume' as TtsProviderId,
            },
          })
        )
      ).rejects.toThrow('(429)');

      expect(mockObserveConcurrencyError).toHaveBeenCalledWith(
        'Hume AI API error (429): concurrency limit exceeded',
        undefined
      );
    });

    it('does not update concurrency on non-429 errors', async () => {
      mockGenerateSpeech.mockRejectedValue(new Error('ElevenLabs API error (500): Internal'));

      await expect(generateTtsAudio(defaultParams())).rejects.toThrow('(500)');

      expect(mockObserveConcurrencyError).not.toHaveBeenCalled();
    });

    it('releases semaphore on error', async () => {
      mockGenerateSpeech.mockRejectedValue(new Error('TTS failed'));

      await expect(generateTtsAudio(defaultParams())).rejects.toThrow('TTS failed');

      expect(mockSemaphoreRelease).toHaveBeenCalled();
    });
  });

  it('does not invoke STT alignment when the TTS provider returns no word timings', async () => {
    const result = await generateTtsAudio(defaultParams({ text: 'Hello world' }));

    expect(result).not.toBeNull();
    expect(result!.wordTimings).toBeNull();
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

      mockGenerateSpeech.mockResolvedValueOnce(chunkAudio).mockResolvedValueOnce(chunkAudio);

      const result = await generateTtsAudio(
        defaultParams({
          text: `${chunk1} ${chunk2}`,
          previousText: 'Before segment.',
          nextText: 'After segment.',
          provider: {
            getConcurrencyLimit: mockGetConcurrencyLimit,
            observeConcurrencyError: mockObserveConcurrencyError,
            generateSpeech: (...args: unknown[]) => mockGenerateSpeech(...args),
            getVoiceId: vi.fn().mockReturnValue('voice-1'),
            getModelId: () => 'eleven_v3',
            getLastContinuityId: mockGetLastContinuityId,
            providerId: 'elevenlabs' as TtsProviderId,
          },
        })
      );

      expect(result).not.toBeNull();
      expect(mockGenerateSpeech).toHaveBeenCalledTimes(2);

      // eleven_v3 is in modelsWithoutTextContext — text context should be undefined
      expect(mockGenerateSpeech).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          text: chunk1,
          previousText: undefined,
          nextText: undefined,
        })
      );

      // Second chunk gets continuityIds from the first chunk
      expect(mockGenerateSpeech).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          text: chunk2,
          previousText: undefined,
          nextText: undefined,
          continuityIds: ['req-1'],
        })
      );

      expect(result!.audioBuffer.byteLength).toBeGreaterThan(chunkAudio.byteLength);
    });

    it('passes text context for non-v3 models', async () => {
      const chunk1 = 'First chunk of text.';
      const chunk2 = 'Second chunk of text.';
      (splitTextForTts as ReturnType<typeof vi.fn>).mockReturnValue([chunk1, chunk2]);

      mockGenerateSpeech.mockResolvedValueOnce(chunkAudio).mockResolvedValueOnce(chunkAudio);

      const result = await generateTtsAudio(
        defaultParams({
          text: `${chunk1} ${chunk2}`,
          previousText: 'Before segment.',
          nextText: 'After segment.',
          provider: {
            getConcurrencyLimit: mockGetConcurrencyLimit,
            observeConcurrencyError: mockObserveConcurrencyError,
            generateSpeech: (...args: unknown[]) => mockGenerateSpeech(...args),
            getVoiceId: vi.fn().mockReturnValue('voice-1'),
            getModelId: () => 'eleven_turbo_v2',
            providerId: 'elevenlabs' as TtsProviderId,
          },
        })
      );

      expect(result).not.toBeNull();
      expect(mockGenerateSpeech).toHaveBeenCalledTimes(2);

      // Non-v3 model keeps text context bridging
      expect(mockGenerateSpeech).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          text: chunk1,
          previousText: 'Before segment.',
          nextText: chunk2.slice(0, 500),
        })
      );

      expect(mockGenerateSpeech).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          text: chunk2,
          previousText: chunk1.slice(-500),
          nextText: 'After segment.',
        })
      );

      expect(result!.audioBuffer.byteLength).toBeGreaterThan(chunkAudio.byteLength);
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
