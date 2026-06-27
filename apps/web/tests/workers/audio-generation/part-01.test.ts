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

  describe('idempotency', () => {
    it('skips TTS when segment already has audio', async () => {
      mockPrismaSegmentFindUnique.mockResolvedValue({
        audioUrl: 'https://cdn.example.com/existing.mp3',
      });
      mockPrismaSegmentCount.mockResolvedValue(3); // still pending

      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockPremiumGenerateSpeech).not.toHaveBeenCalled();
      expect(mockUploadSegmentAudio).not.toHaveBeenCalled();
      expect(mockPrismaSegmentUpdate).not.toHaveBeenCalled();
      expect(mockAddJob).not.toHaveBeenCalled();
    });

    it('triggers stitching when skipped segment was the last pending', async () => {
      mockPrismaSegmentFindUnique.mockResolvedValue({
        audioUrl: 'https://cdn.example.com/existing.mp3',
      });
      mockPrismaSegmentCount.mockResolvedValue(0); // all done
      mockPrismaSegmentFindMany.mockResolvedValue([{ id: 'seg-1' }, { id: 'seg-2' }]);

      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockPremiumGenerateSpeech).not.toHaveBeenCalled();
      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'audio-stitching' },
        'stitch_audio',
        { episodeId: 'episode-001', segmentIds: ['seg-1', 'seg-2'] },
        { jobId: expect.stringMatching(/^stitch-episode-001-\d+$/) }
      );
      expect(mockPrismaEpisodeUpdateMany).toHaveBeenCalledWith({
        where: { id: 'episode-001', status: 'GENERATING_AUDIO' },
        data: { status: 'STITCHING' },
      });
    });
  });

  describe('episode lookup', () => {
    it('fetches episode voice configuration', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockPrismaEpisodeFindUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'episode-001' },
        select: {
          userId: true,
          language: true,
          voices: { select: { speaker: true, voiceId: true, provider: true } },
          ttsProvider: true,
          ttsModel: true,
        },
      });
    });
  });

  describe('voice selection', () => {
    it('calls provider getVoiceId with speaker and episodeId for voice diversity', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockProviderGetVoiceId).toHaveBeenCalledWith(
        'HOST',
        'episode-001',
        undefined,
        undefined
      );
    });

    it('passes HOST speaker to getVoiceId when speaker is HOST', async () => {
      const job = createMockJob({ ...defaultPayload, speaker: 'HOST' });
      await processAudioGeneration(job);

      expect(mockProviderGetVoiceId).toHaveBeenCalledWith(
        'HOST',
        'episode-001',
        undefined,
        undefined
      );
    });

    it('passes EXPERT speaker to getVoiceId when speaker is EXPERT', async () => {
      const job = createMockJob({ ...defaultPayload, speaker: 'EXPERT' });
      await processAudioGeneration(job);

      expect(mockProviderGetVoiceId).toHaveBeenCalledWith(
        'EXPERT',
        'episode-001',
        undefined,
        undefined
      );
    });

    it('uses custom hostVoiceId when set and provider matches', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-1',
        language: null,
        voices: [{ speaker: 'HOST', voiceId: 'custom-host-voice', provider: 'elevenlabs' }],
        ttsProvider: 'elevenlabs',
        ttsModel: null,
        user: {},
      });
      const job = createMockJob({ ...defaultPayload, speaker: 'HOST' });
      await processAudioGeneration(job);

      expect(mockPremiumGenerateSpeech).toHaveBeenCalledWith(
        expect.objectContaining({ voiceId: 'custom-host-voice' })
      );
    });

    it('uses custom expertVoiceId when set and provider matches', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-1',
        language: null,
        voices: [{ speaker: 'EXPERT', voiceId: 'custom-expert-voice', provider: 'elevenlabs' }],
        ttsProvider: 'elevenlabs',
        ttsModel: null,
        user: {},
      });
      const job = createMockJob({ ...defaultPayload, speaker: 'EXPERT' });
      await processAudioGeneration(job);

      expect(mockPremiumGenerateSpeech).toHaveBeenCalledWith(
        expect.objectContaining({ voiceId: 'custom-expert-voice' })
      );
    });

    it('falls back to pool when stored voice has wrong provider', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-1',
        language: null,
        voices: [{ speaker: 'HOST', voiceId: 'elevenlabs-voice-id', provider: 'elevenlabs' }],
        ttsProvider: 'hume',
        ttsModel: null,
        user: {},
      });
      setupHumeProvider();
      mockProviderGetVoiceId.mockReturnValue('hume-pool-voice');
      const job = createMockJob({ ...defaultPayload, speaker: 'HOST' });
      await processAudioGeneration(job);

      // Should NOT use the ElevenLabs voice ID with Hume provider
      expect(mockHumeGenerateSpeech).toHaveBeenCalledWith(
        expect.objectContaining({ voiceId: 'hume-pool-voice' })
      );
    });

    it('uses the provider voice pool when stored voice has no provider', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-1',
        language: null,
        voices: [{ speaker: 'HOST', voiceId: 'old-voice-id', provider: null }],
        ttsProvider: 'elevenlabs',
        ttsModel: null,
        user: {},
      });
      mockProviderGetVoiceId.mockReturnValue('pool-voice');
      const job = createMockJob({ ...defaultPayload, speaker: 'HOST' });
      await processAudioGeneration(job);

      expect(mockPremiumGenerateSpeech).toHaveBeenCalledWith(
        expect.objectContaining({ voiceId: 'pool-voice' })
      );
    });

    it('persists resolved voice when no EpisodeVoice row exists', async () => {
      mockProviderGetVoiceId.mockReturnValue('pool-voice-xyz');
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockPrismaEpisodeVoiceUpsert).toHaveBeenCalledWith({
        where: { episodeId_speaker: { episodeId: 'episode-001', speaker: 'HOST' } },
        update: { voiceId: 'pool-voice-xyz', provider: 'elevenlabs' },
        create: {
          episodeId: 'episode-001',
          speaker: 'HOST',
          voiceId: 'pool-voice-xyz',
          provider: 'elevenlabs',
        },
      });
    });

    it('persists resolved voice when provider mismatch', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-1',
        language: null,
        voices: [{ speaker: 'HOST', voiceId: 'old-elevenlabs-voice', provider: 'elevenlabs' }],
        ttsProvider: 'hume',
        ttsModel: null,
        user: {},
      });
      setupHumeProvider();
      mockProviderGetVoiceId.mockReturnValue('hume-pool-voice');
      const job = createMockJob({ ...defaultPayload, speaker: 'HOST' });
      await processAudioGeneration(job);

      expect(mockPrismaEpisodeVoiceUpsert).toHaveBeenCalledWith({
        where: { episodeId_speaker: { episodeId: 'episode-001', speaker: 'HOST' } },
        update: { voiceId: 'hume-pool-voice', provider: 'hume' },
        create: {
          episodeId: 'episode-001',
          speaker: 'HOST',
          voiceId: 'hume-pool-voice',
          provider: 'hume',
        },
      });
    });

    it('does not upsert when existing voice matches', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-1',
        language: null,
        voices: [{ speaker: 'HOST', voiceId: 'custom-host-voice', provider: 'elevenlabs' }],
        ttsProvider: 'elevenlabs',
        ttsModel: null,
        user: {},
      });
      const job = createMockJob({ ...defaultPayload, speaker: 'HOST' });
      await processAudioGeneration(job);

      expect(mockPrismaEpisodeVoiceUpsert).not.toHaveBeenCalled();
    });

    it('continues without error when upsert fails', async () => {
      mockPrismaEpisodeVoiceUpsert.mockRejectedValue(new Error('DB constraint violation'));
      mockProviderGetVoiceId.mockReturnValue('pool-voice');
      const job = createMockJob(defaultPayload);

      // Should not throw — the upsert failure is caught and logged
      await processAudioGeneration(job);

      expect(mockPremiumGenerateSpeech).toHaveBeenCalledWith(
        expect.objectContaining({ voiceId: 'pool-voice' })
      );
    });
  });

  describe('premium speech generation', () => {
    it('calls premium provider generateSpeech with correct text and voiceId', async () => {
      mockProviderGetVoiceId.mockReturnValue('voice-host-123');
      const job = createMockJob({
        ...defaultPayload,
        text: 'This is a test segment.',
      });
      await processAudioGeneration(job);

      expect(mockPremiumGenerateSpeech).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'This is a test segment.',
          voiceId: 'voice-host-123',
        })
      );
    });

    it('uses the voiceId from provider getVoiceId, not a hardcoded one', async () => {
      mockProviderGetVoiceId.mockReturnValue('completely-different-voice');
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockPremiumGenerateSpeech).toHaveBeenCalledWith(
        expect.objectContaining({ voiceId: 'completely-different-voice' })
      );
    });
  });

  describe('standard voice path', () => {
    beforeEach(() => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-1',
        language: null,
        voices: [],
        ttsProvider: 'openai',
        ttsModel: null,
        user: {},
      });
      setupStandardProvider();
    });

    it('uses standard TTS provider when no custom provider is set', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockStandardGenerateSpeech).toHaveBeenCalled();
      expect(mockPremiumGenerateSpeech).not.toHaveBeenCalled();
    });

    it('uses standard provider getVoiceId', async () => {
      mockStandardGetVoiceId.mockReturnValue('openai-voice-xyz');
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockStandardGetVoiceId).toHaveBeenCalledWith(
        'HOST',
        'episode-001',
        undefined,
        undefined
      );
      expect(mockStandardGenerateSpeech).toHaveBeenCalledWith(
        expect.objectContaining({ voiceId: 'openai-voice-xyz' })
      );
    });
  });

  describe('R2 upload', () => {
    it('uploads the generated audio buffer to R2', async () => {
      const audioBuffer = Buffer.from('generated-audio-bytes');
      mockPremiumGenerateSpeech.mockResolvedValue(audioBuffer);
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockUploadSegmentAudio).toHaveBeenCalledWith(
        'episode-001',
        'segment-001',
        audioBuffer
      );
    });

    it('passes the exact buffer returned by generateSpeech to R2', async () => {
      const specificBuffer = Buffer.from('specific-audio-content-xyz');
      mockPremiumGenerateSpeech.mockResolvedValue(specificBuffer);
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      const uploadedBuffer = mockUploadSegmentAudio.mock.calls[0][2];
      expect(uploadedBuffer).toBe(specificBuffer);
    });
  });

  describe('FFprobe duration extraction', () => {
    const tmpDir = os.tmpdir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tmpProbeRegex = new RegExp(`^${tmpDir}[/\\\\]sotto-probe-[a-f0-9-]+\\.mp3$`);

    it('measures duration via FFprobe after TTS', async () => {
      mockGetAudioDuration.mockResolvedValue(6.543);
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockGetAudioDuration).toHaveBeenCalledWith(expect.stringMatching(tmpProbeRegex));
    });

    it('writes audio buffer to temp file for probing', async () => {
      const audioBuffer = Buffer.from('audio-data-for-probing');
      mockPremiumGenerateSpeech.mockResolvedValue(audioBuffer);
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockWriteFile).toHaveBeenCalledWith(expect.stringMatching(tmpProbeRegex), audioBuffer);
    });

    it('cleans up temp file after probing', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockRm).toHaveBeenCalledWith(expect.stringMatching(tmpProbeRegex), { force: true });
    });

    it('falls back to text estimation when FFprobe fails', async () => {
      mockGetAudioDuration.mockRejectedValue(new Error('FFprobe not found'));
      const job = createMockJob({
        ...defaultPayload,
        text: 'A'.repeat(125), // 125 chars ÷ 12.5 chars/sec = 10 sec
      });
      await processAudioGeneration(job);

      // Should still update segment with estimated duration
      expect(mockPrismaSegmentUpdate).toHaveBeenCalledWith({
        where: { id: 'segment-001' },
        data: {
          audioUrl: expect.any(String),
          duration: 10, // 125 / 12.5
        },
      });
    });

    it('cleans up temp file even when FFprobe fails', async () => {
      mockGetAudioDuration.mockRejectedValue(new Error('FFprobe failed'));
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockRm).toHaveBeenCalledWith(expect.stringMatching(tmpProbeRegex), { force: true });
    });

    it('stores measured duration in segment update', async () => {
      mockGetAudioDuration.mockResolvedValue(12.345);
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockPrismaSegmentUpdate).toHaveBeenCalledWith({
        where: { id: 'segment-001' },
        data: {
          audioUrl: expect.any(String),
          duration: 12.345,
        },
      });
    });
  });

  describe('database updates', () => {
    it('updates the segment with the audio URL and duration', async () => {
      mockUploadSegmentAudio.mockResolvedValue('https://media.example.com/segments/seg-001.mp3');
      mockGetAudioDuration.mockResolvedValue(7.89);
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockPrismaSegmentUpdate).toHaveBeenCalledWith({
        where: { id: 'segment-001' },
        data: { audioUrl: 'https://media.example.com/segments/seg-001.mp3', duration: 7.89 },
      });
    });

    it('logs TTS cost to apiUsageLog', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockPrismaApiUsageLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          episodeId: 'episode-001',
          userId: 'user-1',
          service: 'elevenlabs',
          category: 'audio_generation',
        }),
      });
    });

    it('calculates non-zero totalCost for platform source', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      const callArgs = mockPrismaApiUsageLogCreate.mock.calls[0][0];
      // "Welcome to the show!" = 20 chars → (20/1000) * 0.3 = 0.006
      expect(callArgs.data.totalCost).toBeCloseTo(0.006, 6);
    });

    it('calculates non-zero totalCost for BYOK source', async () => {
      setupByokProvider('elevenlabs');
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      const callArgs = mockPrismaApiUsageLogCreate.mock.calls[0][0];
      // Same rate applies: (20/1000) * 0.3 = 0.006
      expect(callArgs.data.totalCost).toBeCloseTo(0.006, 6);
      expect(callArgs.data.service).toBe('elevenlabs_byok');
    });

    it('calculates cost using the correct provider rate for BYOK OpenAI', async () => {
      setupByokProvider('openai');
      const { getProviderMeta } = await import('@/lib/providers/tts-registry');
      (getProviderMeta as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'openai',
        displayName: 'OpenAI',
        platformCostPerKChar: 0.015,
        qualityTier: 'standard',
      });

      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      const callArgs = mockPrismaApiUsageLogCreate.mock.calls[0][0];
      // (20/1000) * 0.015 = 0.0003
      expect(callArgs.data.totalCost).toBeCloseTo(0.0003, 6);
      expect(callArgs.data.service).toBe('openai_byok');
    });

    it('checks the count of pending segments for this episode', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockPrismaSegmentCount).toHaveBeenCalledWith({
        where: { episodeId: 'episode-001', audioUrl: null },
      });
    });
  });

  describe('stitching queue (all segments complete)', () => {
    beforeEach(() => {
      mockPrismaSegmentCount.mockResolvedValue(0);
    });

    it('queries all segments ordered by order ascending when no pending remain', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockPrismaSegmentFindMany).toHaveBeenCalledWith({
        where: { episodeId: 'episode-001' },
        orderBy: { order: 'asc' },
        select: { id: true },
      });
    });

    it('queues a stitching job with all segment IDs and stable jobId', async () => {
      mockPrismaSegmentFindMany.mockResolvedValue([
        { id: 'seg-a' },
        { id: 'seg-b' },
        { id: 'seg-c' },
      ]);
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'audio-stitching' },
        'stitch_audio',
        {
          episodeId: 'episode-001',
          segmentIds: ['seg-a', 'seg-b', 'seg-c'],
        },
        { jobId: expect.stringMatching(/^stitch-episode-001-\d+$/) }
      );
    });

    it('CAS-updates episode status to STITCHING', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockPrismaEpisodeUpdateMany).toHaveBeenCalledWith({
        where: { id: 'episode-001', status: 'GENERATING_AUDIO' },
        data: { status: 'STITCHING' },
      });
    });

    it('queues stitching for a single-segment episode', async () => {
      mockPrismaSegmentFindMany.mockResolvedValue([{ id: 'only-segment' }]);
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockAddJob).toHaveBeenCalledWith(
        expect.anything(),
        'stitch_audio',
        expect.objectContaining({ segmentIds: ['only-segment'] }),
        { jobId: expect.stringMatching(/^stitch-episode-001-\d+$/) }
      );
    });
  });
});
