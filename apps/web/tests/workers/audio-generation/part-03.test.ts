import os from 'os';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks (must be declared before any import that touches the modules) ----

const mockPrismaSegmentFindUnique = vi.fn().mockResolvedValue(null);
const mockPrismaSegmentUpdate = vi.fn().mockResolvedValue({});
const mockPrismaSegmentCount = vi.fn().mockResolvedValue(0);
const mockPrismaSegmentFindMany = vi.fn().mockResolvedValue([]);
const mockPrismaEpisodeUpdate = vi.fn().mockResolvedValue({});
const mockPrismaEpisodeUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const mockPrismaEpisodeFindUnique = vi.fn().mockResolvedValue({ status: 'GENERATING_AUDIO' });
const mockPrismaEpisodeFindUniqueOrThrow = vi.fn().mockResolvedValue({
  userId: 'user-1',
  language: null,
  voices: [],
  ttsProvider: 'elevenlabs',
  ttsModel: null,
  user: {},
});
const mockPrismaApiUsageLogCreate = vi.fn().mockResolvedValue({});
const mockPrismaDiscoveryFindUnique = vi.fn().mockResolvedValue(null);
const mockPrismaScriptFindUnique = vi.fn().mockResolvedValue(null);
const mockPrismaEpisodeVoiceUpsert = vi.fn().mockResolvedValue({});

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    segment: {
      findUnique: (...args: unknown[]) => mockPrismaSegmentFindUnique(...args),
      update: (...args: unknown[]) => mockPrismaSegmentUpdate(...args),
      count: (...args: unknown[]) => mockPrismaSegmentCount(...args),
      findMany: (...args: unknown[]) => mockPrismaSegmentFindMany(...args),
    },
    episode: {
      update: (...args: unknown[]) => mockPrismaEpisodeUpdate(...args),
      updateMany: (...args: unknown[]) => mockPrismaEpisodeUpdateMany(...args),
      findUnique: (...args: unknown[]) => mockPrismaEpisodeFindUnique(...args),
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaEpisodeFindUniqueOrThrow(...args),
    },
    discovery: {
      findUnique: (...args: unknown[]) => mockPrismaDiscoveryFindUnique(...args),
    },
    script: {
      findUnique: (...args: unknown[]) => mockPrismaScriptFindUnique(...args),
    },
    apiUsageLog: {
      create: (...args: unknown[]) => mockPrismaApiUsageLogCreate(...args),
    },
    episodeVoice: {
      upsert: (...args: unknown[]) => mockPrismaEpisodeVoiceUpsert(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@/lib/elevenlabs', () => ({
  getVoiceId: vi.fn().mockReturnValue('voice-abc'),
  getVoiceProfile: vi.fn().mockReturnValue({}),
  getElevenLabsPerKCharRate: vi.fn().mockReturnValue(0.3),
  getOpenAiPerKCharRate: vi.fn().mockReturnValue(0.03),
  getElevenLabsConcurrencyLimit: vi.fn().mockResolvedValue(5),
}));

vi.mock('@/lib/providers/tts/cartesia.provider', () => ({
  CartesiaProvider: vi.fn(),
  getCartesiaConcurrencyLimit: vi.fn().mockResolvedValue(2),
  updateCartesiaConcurrencyFromError: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/providers/tts/hume.provider', () => ({
  HumeProvider: vi.fn(),
  getHumeConcurrencyLimit: vi.fn().mockResolvedValue(5),
  updateHumeConcurrencyFromError: vi.fn().mockResolvedValue(undefined),
}));

const mockPremiumGenerateSpeech = vi.fn().mockResolvedValue(Buffer.from('fake-audio'));
const mockStandardGenerateSpeech = vi.fn().mockResolvedValue(Buffer.from('fake-audio'));
const mockProviderGetVoiceId = vi.fn().mockReturnValue('voice-abc');
const mockStandardGetVoiceId = vi.fn().mockReturnValue('openai-voice-abc');

const mockResolveTtsProvider = vi.fn();
const mockCreateTtsProviderAsync = vi.fn();

vi.mock('@/lib/providers', () => ({
  resolveTtsProvider: (...args: unknown[]) => mockResolveTtsProvider(...args),
  createPremiumTtsProvider: vi.fn(),
  createTtsProvider: vi.fn(),
  createTtsProviderAsync: (...args: unknown[]) => mockCreateTtsProviderAsync(...args),
}));

vi.mock('@/lib/providers/tts-registry', () => ({
  getProviderMeta: vi.fn().mockReturnValue({
    id: 'elevenlabs',
    displayName: 'ElevenLabs',
    platformCostPerKChar: 0.3,
    qualityTier: 'premium',
  }),
}));

const mockUploadSegmentAudio = vi.fn().mockResolvedValue('https://r2.example.com/audio.mp3');
const mockAssertStorageWritable = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/r2', () => ({
  assertStorageWritable: (...args: unknown[]) => mockAssertStorageWritable(...args),
  uploadSegmentAudio: (...args: unknown[]) => mockUploadSegmentAudio(...args),
}));

const mockGetAudioDuration = vi.fn().mockResolvedValue(5.234);

vi.mock('@/lib/audio-stitcher', () => ({
  getAudioDuration: (...args: unknown[]) => mockGetAudioDuration(...args),
}));

const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockRm = vi.fn().mockResolvedValue(undefined);

vi.mock('fs/promises', () => ({
  default: {
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    rm: (...args: unknown[]) => mockRm(...args),
  },
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  rm: (...args: unknown[]) => mockRm(...args),
}));

const mockAddJob = vi.fn().mockResolvedValue({ id: 'stitch-job-1' });

vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: {
    STITCH_AUDIO: 'stitch_audio',
  },
  audioStitchingQueue: { name: 'audio-stitching' },
}));

vi.mock('@/lib/redis', () => ({
  semaphore: {
    acquire: vi.fn().mockResolvedValue(true),
    release: vi.fn().mockResolvedValue(undefined),
  },
  invalidateEpisodeCache: vi.fn().mockResolvedValue(undefined),
  publishEpisodeStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/byok', () => ({
  getByokKey: vi.fn().mockResolvedValue(null),
  getSharedByokKey: vi.fn().mockResolvedValue(null),
  hasSharedByokKey: vi.fn().mockResolvedValue(false),
  getByokExtraData: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/tts-text-cleaner', () => ({
  cleanTextForTts: vi.fn((text: string) => text),
  splitTextForTts: vi.fn((text: string) => [text]),
}));

// ---- Import under test ----
import { processAudioGeneration } from '@/workers/audio-generation.worker';
import type { GenerateAudioPayload } from '@/lib/queue';
import type { Job } from 'bullmq';
import {
  getCartesiaConcurrencyLimit,
  updateCartesiaConcurrencyFromError,
} from '@/lib/providers/tts/cartesia.provider';
import {
  getHumeConcurrencyLimit,
  updateHumeConcurrencyFromError,
} from '@/lib/providers/tts/hume.provider';
import { semaphore } from '@/lib/redis';
import { getElevenLabsConcurrencyLimit } from '@/lib/elevenlabs';

// ---- Helpers ----

function createMockJob(data: GenerateAudioPayload): Job<GenerateAudioPayload> {
  return {
    data,
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<GenerateAudioPayload>;
}

const defaultPayload: GenerateAudioPayload = {
  episodeId: 'episode-001',
  segmentId: 'segment-001',
  speaker: 'HOST',
  text: 'Welcome to the show!',
};

function setupPremiumProvider() {
  mockResolveTtsProvider.mockResolvedValue({
    provider: {
      generateSpeech: (...args: unknown[]) => mockPremiumGenerateSpeech(...args),
      getVoiceId: (...args: unknown[]) => mockProviderGetVoiceId(...args),
      getModelId: () => 'eleven_v3',
      providerId: 'elevenlabs',
    },
    source: 'platform',
    providerId: 'elevenlabs',
  });
}

function setupStandardProvider() {
  mockResolveTtsProvider.mockResolvedValue({
    provider: {
      generateSpeech: (...args: unknown[]) => mockStandardGenerateSpeech(...args),
      getVoiceId: (...args: unknown[]) => mockStandardGetVoiceId(...args),
      getModelId: () => 'tts-1-hd',
      providerId: 'openai',
    },
    source: 'platform',
    providerId: 'openai',
  });
}

function setupByokProvider(providerId: 'elevenlabs' | 'openai' = 'elevenlabs') {
  const isElevenLabs = providerId === 'elevenlabs';
  mockResolveTtsProvider.mockResolvedValue({
    provider: {
      generateSpeech: isElevenLabs
        ? (...args: unknown[]) => mockPremiumGenerateSpeech(...args)
        : (...args: unknown[]) => mockStandardGenerateSpeech(...args),
      getVoiceId: isElevenLabs
        ? (...args: unknown[]) => mockProviderGetVoiceId(...args)
        : (...args: unknown[]) => mockStandardGetVoiceId(...args),
      getModelId: () => (isElevenLabs ? 'eleven_v3' : 'tts-1-hd'),
      providerId,
    },
    source: 'byok',
    providerId,
  });
}

const mockCartesiaGenerateSpeech = vi.fn().mockResolvedValue(Buffer.from('fake-audio'));
const mockHumeGenerateSpeech = vi.fn().mockResolvedValue(Buffer.from('fake-audio'));

function setupCartesiaProvider() {
  mockResolveTtsProvider.mockResolvedValue({
    provider: {
      generateSpeech: (...args: unknown[]) => mockCartesiaGenerateSpeech(...args),
      getVoiceId: (...args: unknown[]) => mockProviderGetVoiceId(...args),
      getModelId: () => 'sonic-3',
      providerId: 'cartesia',
    },
    source: 'platform',
    providerId: 'cartesia',
  });
}

function setupHumeProvider() {
  mockResolveTtsProvider.mockResolvedValue({
    provider: {
      generateSpeech: (...args: unknown[]) => mockHumeGenerateSpeech(...args),
      getVoiceId: (...args: unknown[]) => mockProviderGetVoiceId(...args),
      getModelId: () => 'octave-v1',
      providerId: 'hume',
    },
    source: 'platform',
    providerId: 'hume',
  });
}

// ---- Tests ----

void os;
void getCartesiaConcurrencyLimit;
void updateCartesiaConcurrencyFromError;
void getHumeConcurrencyLimit;
void updateHumeConcurrencyFromError;
void semaphore;
void getElevenLabsConcurrencyLimit;
void setupPremiumProvider;
void setupStandardProvider;
void setupByokProvider;
void setupCartesiaProvider;
void setupHumeProvider;

describe('processAudioGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: segment has no existing audio
    mockPrismaSegmentFindUnique.mockResolvedValue(null);
    // Default: episode not failed (fail-fast check passes)
    mockPrismaEpisodeFindUnique.mockResolvedValue({ status: 'GENERATING_AUDIO' });
    mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
      userId: 'user-1',
      language: null,
      voices: [],
      ttsProvider: 'elevenlabs',
      ttsModel: null,
      user: {},
    });
    // Default: no pending segments (all done)
    mockPrismaSegmentCount.mockResolvedValue(0);
    mockPrismaSegmentFindMany.mockResolvedValue([{ id: 'segment-001' }, { id: 'segment-002' }]);
    mockPrismaSegmentUpdate.mockResolvedValue({});
    mockPremiumGenerateSpeech.mockResolvedValue(Buffer.from('fake-audio-data'));
    mockStandardGenerateSpeech.mockResolvedValue(Buffer.from('fake-audio-data'));
    mockCartesiaGenerateSpeech.mockResolvedValue(Buffer.from('fake-audio-data'));
    mockHumeGenerateSpeech.mockResolvedValue(Buffer.from('fake-audio-data'));
    mockUploadSegmentAudio.mockResolvedValue(
      'https://r2.example.com/episodes/episode-001/segments/segment-001.mp3'
    );
    mockProviderGetVoiceId.mockReturnValue('voice-abc');
    mockStandardGetVoiceId.mockReturnValue('openai-voice-abc');
    mockGetAudioDuration.mockResolvedValue(5.234);
    mockWriteFile.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
    // Default: premium provider via resolveTtsProvider
    setupPremiumProvider();
  });

  describe('per-segment TTS override (showcase)', () => {
    const mockOverrideGenerateSpeech = vi.fn().mockResolvedValue(Buffer.from('override-audio'));
    const mockOverrideGetVoiceId = vi.fn().mockReturnValue('cartesia-voice-1');

    function setupSegmentOverride(overrides: {
      ttsProvider: string;
      ttsModel?: string;
      ttsVoiceId?: string;
    }) {
      // Segment exists (no audio yet) with TTS overrides
      mockPrismaSegmentFindUnique.mockResolvedValue({
        audioUrl: null,
        ttsProvider: overrides.ttsProvider,
        ttsModel: overrides.ttsModel ?? null,
        ttsVoiceId: overrides.ttsVoiceId ?? null,
      });

      // createTtsProviderAsync returns a mock provider for the override
      mockCreateTtsProviderAsync.mockResolvedValue({
        generateSpeech: (...args: unknown[]) => mockOverrideGenerateSpeech(...args),
        getVoiceId: (...args: unknown[]) => mockOverrideGetVoiceId(...args),
        getModelId: () => overrides.ttsModel ?? 'sonic-3',
        providerId: overrides.ttsProvider,
      });
    }

    beforeEach(() => {
      mockOverrideGenerateSpeech.mockResolvedValue(Buffer.from('override-audio'));
      mockOverrideGetVoiceId.mockReturnValue('cartesia-voice-1');
    });

    it('uses segment-level provider when ttsProvider is set', async () => {
      setupSegmentOverride({ ttsProvider: 'cartesia', ttsModel: 'sonic-3' });
      process.env.CARTESIA_API_KEY = 'platform-cartesia-key';

      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      // Should use createTtsProviderAsync, not resolveTtsProvider
      expect(mockCreateTtsProviderAsync).toHaveBeenCalledWith(
        'cartesia',
        'platform-cartesia-key',
        undefined,
        'sonic-3'
      );
      expect(mockResolveTtsProvider).not.toHaveBeenCalled();
      expect(mockOverrideGenerateSpeech).toHaveBeenCalled();

      delete process.env.CARTESIA_API_KEY;
    });

    it('falls back to episode-level flow when segment has no ttsProvider', async () => {
      // Segment with no TTS override
      mockPrismaSegmentFindUnique.mockResolvedValue({
        audioUrl: null,
        ttsProvider: null,
        ttsModel: null,
        ttsVoiceId: null,
      });

      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockResolveTtsProvider).toHaveBeenCalled();
      expect(mockCreateTtsProviderAsync).not.toHaveBeenCalled();
    });

    it('uses segment ttsVoiceId when provided', async () => {
      setupSegmentOverride({
        ttsProvider: 'elevenlabs',
        ttsModel: 'eleven_v3',
        ttsVoiceId: 'specific-voice-id',
      });
      process.env.ELEVENLABS_API_KEY = 'platform-el-key';

      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockOverrideGenerateSpeech).toHaveBeenCalledWith(
        expect.objectContaining({ voiceId: 'specific-voice-id' })
      );
      // Should NOT call provider.getVoiceId since segment specifies voice
      expect(mockOverrideGetVoiceId).not.toHaveBeenCalled();

      delete process.env.ELEVENLABS_API_KEY;
    });

    it('falls back to provider getVoiceId when segment has no ttsVoiceId', async () => {
      setupSegmentOverride({ ttsProvider: 'cartesia' });
      process.env.CARTESIA_API_KEY = 'platform-cartesia-key';

      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockOverrideGetVoiceId).toHaveBeenCalledWith(
        'HOST',
        'episode-001',
        undefined,
        undefined
      );
      expect(mockOverrideGenerateSpeech).toHaveBeenCalledWith(
        expect.objectContaining({ voiceId: 'cartesia-voice-1' })
      );

      delete process.env.CARTESIA_API_KEY;
    });

    it('persists voice assignment for segment override', async () => {
      setupSegmentOverride({ ttsProvider: 'cartesia', ttsVoiceId: 'cart-voice-42' });
      process.env.CARTESIA_API_KEY = 'platform-key';

      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockPrismaEpisodeVoiceUpsert).toHaveBeenCalledWith({
        where: { episodeId_speaker: { episodeId: 'episode-001', speaker: 'HOST' } },
        update: { voiceId: 'cart-voice-42', provider: 'cartesia' },
        create: {
          episodeId: 'episode-001',
          speaker: 'HOST',
          voiceId: 'cart-voice-42',
          provider: 'cartesia',
        },
      });

      delete process.env.CARTESIA_API_KEY;
    });
  });
});
