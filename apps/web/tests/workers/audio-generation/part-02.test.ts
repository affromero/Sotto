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

vi.mock('@/lib/r2', () => ({
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

  describe('stitching queue (segments still pending)', () => {
    beforeEach(() => {
      mockPrismaSegmentCount.mockResolvedValue(3);
      // Set ttsProvider + ttsModel so the write-back update is skipped
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-1',
        language: null,
        voices: [],
        ttsProvider: 'elevenlabs',
        ttsModel: 'eleven_v3',
        user: {},
      });
    });

    it('does not queue stitching when segments are still pending', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockAddJob).not.toHaveBeenCalled();
    });

    it('does not update episode status when segments are still pending', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockPrismaEpisodeUpdateMany).not.toHaveBeenCalled();
    });

    it('does not query segments list when segments are still pending', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockPrismaSegmentFindMany).not.toHaveBeenCalled();
    });

    it('does not queue stitching when exactly 1 segment is still pending', async () => {
      mockPrismaSegmentCount.mockResolvedValue(1);
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockAddJob).not.toHaveBeenCalled();
    });
  });

  describe('job progress updates', () => {
    it('reports progress at 10% after starting', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(job.updateProgress).toHaveBeenCalledWith(10);
    });

    it('reports progress at 60% after speech generation', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(job.updateProgress).toHaveBeenCalledWith(60);
    });

    it('reports progress at 90% after segment update', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(job.updateProgress).toHaveBeenCalledWith(90);
    });

    it('reports progress at 100% at the end', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(job.updateProgress).toHaveBeenCalledWith(100);
    });

    it('reports progress in the correct order', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      const progressCalls = (job.updateProgress as ReturnType<typeof vi.fn>).mock.calls.map(
        (call: number[]) => call[0]
      );
      expect(progressCalls).toEqual([10, 60, 90, 100]);
    });
  });

  describe('end-to-end flow', () => {
    it('executes the full pipeline for a HOST segment (premium voice)', async () => {
      mockProviderGetVoiceId.mockReturnValue('host-voice-id');
      mockPremiumGenerateSpeech.mockResolvedValue(Buffer.from('host-audio'));
      mockUploadSegmentAudio.mockResolvedValue('https://r2.example.com/host-audio.mp3');
      mockPrismaSegmentCount.mockResolvedValue(0);
      mockPrismaSegmentFindMany.mockResolvedValue([{ id: 'segment-001' }]);

      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      // Voice selected via provider
      expect(mockProviderGetVoiceId).toHaveBeenCalledWith(
        'HOST',
        'episode-001',
        undefined,
        undefined
      );

      // Audio generated via premium provider
      expect(mockPremiumGenerateSpeech).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Welcome to the show!',
          voiceId: 'host-voice-id',
        })
      );

      // Uploaded to R2
      expect(mockUploadSegmentAudio).toHaveBeenCalledWith(
        'episode-001',
        'segment-001',
        Buffer.from('host-audio')
      );

      // Segment updated
      expect(mockPrismaSegmentUpdate).toHaveBeenCalledWith({
        where: { id: 'segment-001' },
        data: { audioUrl: 'https://r2.example.com/host-audio.mp3', duration: expect.any(Number) },
      });

      // Cost logged
      expect(mockPrismaApiUsageLogCreate).toHaveBeenCalled();

      // Stitching queued (last segment) with CAS
      expect(mockAddJob).toHaveBeenCalled();
      expect(mockPrismaEpisodeUpdateMany).toHaveBeenCalledWith({
        where: { id: 'episode-001', status: 'GENERATING_AUDIO' },
        data: { status: 'STITCHING' },
      });
    });

    it('executes the full pipeline for an EXPERT segment that is not the last', async () => {
      mockProviderGetVoiceId.mockReturnValue('expert-voice-id');
      mockPremiumGenerateSpeech.mockResolvedValue(Buffer.from('expert-audio'));
      mockUploadSegmentAudio.mockResolvedValue('https://r2.example.com/expert-audio.mp3');
      mockPrismaSegmentCount.mockResolvedValue(5);
      // Set ttsProvider + ttsModel so the write-back update is skipped
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-1',
        language: null,
        voices: [],
        ttsProvider: 'elevenlabs',
        ttsModel: 'eleven_v3',
        user: {},
      });

      const job = createMockJob({
        episodeId: 'episode-002',
        segmentId: 'segment-042',
        speaker: 'EXPERT',
        text: 'That is a great question, let me explain.',
      });
      await processAudioGeneration(job);

      // Voice selected for EXPERT via provider
      expect(mockProviderGetVoiceId).toHaveBeenCalledWith(
        'EXPERT',
        'episode-002',
        undefined,
        undefined
      );

      // Audio generated via premium provider
      expect(mockPremiumGenerateSpeech).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'That is a great question, let me explain.',
          voiceId: 'expert-voice-id',
        })
      );

      // Uploaded
      expect(mockUploadSegmentAudio).toHaveBeenCalledWith(
        'episode-002',
        'segment-042',
        Buffer.from('expert-audio')
      );

      // Segment updated
      expect(mockPrismaSegmentUpdate).toHaveBeenCalledWith({
        where: { id: 'segment-042' },
        data: { audioUrl: 'https://r2.example.com/expert-audio.mp3', duration: expect.any(Number) },
      });

      // No stitching (still pending)
      expect(mockAddJob).not.toHaveBeenCalled();
      expect(mockPrismaEpisodeUpdateMany).not.toHaveBeenCalled();
    });
  });

  describe('prosody context passthrough', () => {
    it('passes previousText and nextText to generateSpeech when provided', async () => {
      const job = createMockJob({
        ...defaultPayload,
        previousText: 'Previous segment text',
        nextText: 'Next segment text',
      });
      await processAudioGeneration(job);

      expect(mockPremiumGenerateSpeech).toHaveBeenCalledWith(
        expect.objectContaining({
          previousText: 'Previous segment text',
          nextText: 'Next segment text',
        })
      );
    });

    it('passes undefined previousText and nextText when not in payload', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockPremiumGenerateSpeech).toHaveBeenCalledWith(
        expect.objectContaining({
          previousText: undefined,
          nextText: undefined,
        })
      );
    });
  });

  describe('tone inference from script delivery directions', () => {
    beforeEach(() => {
      // Discovery has no tone — triggers inference from script
      mockPrismaDiscoveryFindUnique.mockResolvedValue({
        tone: null,
        audienceLevel: 'intermediate',
        audience: 'general',
      });
    });

    it('infers casual tone from enthusiastic/playful directions', async () => {
      mockPrismaScriptFindUnique.mockResolvedValue({
        turns: [
          { speaker: 'HOST', direction: 'enthusiastic' },
          { speaker: 'EXPERT', direction: 'playful' },
        ],
      });

      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockProviderGetVoiceId).toHaveBeenCalledWith(
        'HOST',
        'episode-001',
        expect.objectContaining({ tone: 'casual' }),
        undefined
      );
    });

    it('infers professional tone from serious/formal directions', async () => {
      mockPrismaScriptFindUnique.mockResolvedValue({
        turns: [
          { speaker: 'HOST', direction: 'serious' },
          { speaker: 'EXPERT', direction: 'formal' },
        ],
      });

      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockProviderGetVoiceId).toHaveBeenCalledWith(
        'HOST',
        'episode-001',
        expect.objectContaining({ tone: 'professional' }),
        undefined
      );
    });

    it('skips inference when discovery already has tone', async () => {
      mockPrismaDiscoveryFindUnique.mockResolvedValue({
        tone: 'casual',
        audienceLevel: 'intermediate',
        audience: 'general',
      });

      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      // Should NOT fetch script for inference
      expect(mockPrismaScriptFindUnique).not.toHaveBeenCalled();
      expect(mockProviderGetVoiceId).toHaveBeenCalledWith(
        'HOST',
        'episode-001',
        expect.objectContaining({ tone: 'casual' }),
        undefined
      );
    });

    it('does not set tone when no directions match any pattern', async () => {
      mockPrismaScriptFindUnique.mockResolvedValue({
        turns: [{ speaker: 'HOST', direction: 'neutral' }, { speaker: 'EXPERT' }],
      });

      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      // No pattern match → tone stays null from discovery (not overwritten)
      const voiceMetadataArg = mockProviderGetVoiceId.mock.calls[0][2];
      expect(voiceMetadataArg).toBeDefined();
      expect(voiceMetadataArg.tone).toBeNull();
    });

    it('passes undefined metadata when discovery is null and script has no directions', async () => {
      mockPrismaDiscoveryFindUnique.mockResolvedValue(null);
      mockPrismaScriptFindUnique.mockResolvedValue({
        turns: [{ speaker: 'HOST' }, { speaker: 'EXPERT' }],
      });

      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockProviderGetVoiceId).toHaveBeenCalledWith(
        'HOST',
        'episode-001',
        undefined,
        undefined
      );
    });
  });

  describe('error propagation', () => {
    it('rejects episode audio generation when no TTS provider is persisted', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-1',
        language: null,
        voices: [],
        ttsProvider: null,
        ttsModel: null,
        user: {},
      });
      const job = createMockJob(defaultPayload);

      await expect(processAudioGeneration(job)).rejects.toThrow(
        'Episode episode-001 is missing a TTS provider'
      );
      expect(mockResolveTtsProvider).not.toHaveBeenCalled();
      expect(mockPremiumGenerateSpeech).not.toHaveBeenCalled();
    });

    it('propagates errors from premium generateSpeech', async () => {
      mockPremiumGenerateSpeech.mockRejectedValue(
        new Error('ElevenLabs API error (429): rate limited')
      );
      const job = createMockJob(defaultPayload);

      await expect(processAudioGeneration(job)).rejects.toThrow(
        'ElevenLabs API error (429): rate limited'
      );
    });

    it('propagates errors from uploadSegmentAudio', async () => {
      mockUploadSegmentAudio.mockRejectedValue(new Error('R2 storage not configured'));
      const job = createMockJob(defaultPayload);

      await expect(processAudioGeneration(job)).rejects.toThrow('R2 storage not configured');
    });

    it('propagates errors from prisma segment update', async () => {
      mockPrismaSegmentUpdate.mockRejectedValue(new Error('Record not found'));
      const job = createMockJob(defaultPayload);

      await expect(processAudioGeneration(job)).rejects.toThrow('Record not found');
    });
  });

  describe('concurrency limit resolution', () => {
    it('uses getCartesiaConcurrencyLimit for Cartesia provider', async () => {
      setupCartesiaProvider();
      process.env.CARTESIA_API_KEY = 'test-cartesia-key';
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(getCartesiaConcurrencyLimit).toHaveBeenCalledWith('test-cartesia-key');
      expect(semaphore.acquire).toHaveBeenCalledWith(expect.stringContaining('cartesia'), 2);
      delete process.env.CARTESIA_API_KEY;
    });

    it('uses getHumeConcurrencyLimit for Hume provider', async () => {
      setupHumeProvider();
      process.env.HUME_API_KEY = 'test-hume-key';
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(getHumeConcurrencyLimit).toHaveBeenCalledWith('test-hume-key');
      expect(semaphore.acquire).toHaveBeenCalledWith(expect.stringContaining('hume'), 5);
      delete process.env.HUME_API_KEY;
    });

    it('still uses getElevenLabsConcurrencyLimit for ElevenLabs provider', async () => {
      setupPremiumProvider();
      process.env.ELEVENLABS_API_KEY = 'test-el-key';
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(getElevenLabsConcurrencyLimit).toHaveBeenCalledWith('test-el-key');
      delete process.env.ELEVENLABS_API_KEY;
    });

    it('falls back to default 5 for unknown providers without API key', async () => {
      setupStandardProvider(); // openai
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(semaphore.acquire).toHaveBeenCalledWith(expect.stringContaining('openai'), 5);
    });
  });

  describe('429 error handling', () => {
    it('calls updateCartesiaConcurrencyFromError on Cartesia 429', async () => {
      setupCartesiaProvider();
      process.env.CARTESIA_API_KEY = 'test-cartesia-key';
      mockCartesiaGenerateSpeech.mockRejectedValue(
        new Error('Cartesia API error (429): Rate limited. Current limit: 3')
      );
      const job = createMockJob(defaultPayload);

      await expect(processAudioGeneration(job)).rejects.toThrow('(429)');
      expect(updateCartesiaConcurrencyFromError).toHaveBeenCalledWith(
        'test-cartesia-key',
        'Cartesia API error (429): Rate limited. Current limit: 3'
      );
      delete process.env.CARTESIA_API_KEY;
    });

    it('calls updateHumeConcurrencyFromError on Hume 429', async () => {
      setupHumeProvider();
      process.env.HUME_API_KEY = 'test-hume-key';
      mockHumeGenerateSpeech.mockRejectedValue(
        new Error('Hume AI API error (429): concurrency limit 3 exceeded')
      );
      const job = createMockJob(defaultPayload);

      await expect(processAudioGeneration(job)).rejects.toThrow('(429)');
      expect(updateHumeConcurrencyFromError).toHaveBeenCalledWith(
        'test-hume-key',
        'Hume AI API error (429): concurrency limit 3 exceeded'
      );
      delete process.env.HUME_API_KEY;
    });

    it('does not call update functions on non-429 errors', async () => {
      setupCartesiaProvider();
      process.env.CARTESIA_API_KEY = 'test-cartesia-key';
      mockCartesiaGenerateSpeech.mockRejectedValue(
        new Error('Cartesia API error (500): internal server error')
      );
      const job = createMockJob(defaultPayload);

      await expect(processAudioGeneration(job)).rejects.toThrow('(500)');
      expect(updateCartesiaConcurrencyFromError).not.toHaveBeenCalled();
      delete process.env.CARTESIA_API_KEY;
    });

    it('releases semaphore on 429 error', async () => {
      setupCartesiaProvider();
      process.env.CARTESIA_API_KEY = 'test-cartesia-key';
      mockCartesiaGenerateSpeech.mockRejectedValue(
        new Error('Cartesia API error (429): Rate limited. Current limit: 2')
      );
      const job = createMockJob(defaultPayload);

      await expect(processAudioGeneration(job)).rejects.toThrow('(429)');
      expect(semaphore.release).toHaveBeenCalled();
      delete process.env.CARTESIA_API_KEY;
    });
  });
});
