import os from 'os';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks (must be declared before any import that touches the modules) ----

const mockPrismaSegmentFindUnique = vi.fn().mockResolvedValue(null);
const mockPrismaSegmentUpdate = vi.fn().mockResolvedValue({});
const mockPrismaSegmentCount = vi.fn().mockResolvedValue(0);
const mockPrismaSegmentFindMany = vi.fn().mockResolvedValue([]);
const mockPrismaPodcastUpdate = vi.fn().mockResolvedValue({});
const mockPrismaPodcastUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const mockPrismaPodcastFindUnique = vi.fn().mockResolvedValue({ status: 'GENERATING_AUDIO' });
const mockPrismaPodcastFindUniqueOrThrow = vi.fn().mockResolvedValue({
  userId: 'user-1',
  voices: [],
  ttsProvider: null,
  ttsModel: null,
  user: { plan: 'FREE' },
});
const mockPrismaApiUsageLogCreate = vi.fn().mockResolvedValue({});
const mockPrismaDiscoveryFindUnique = vi.fn().mockResolvedValue(null);
const mockPrismaScriptFindUnique = vi.fn().mockResolvedValue(null);
const mockPrismaPodcastVoiceUpsert = vi.fn().mockResolvedValue({});

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    segment: {
      findUnique: (...args: unknown[]) => mockPrismaSegmentFindUnique(...args),
      update: (...args: unknown[]) => mockPrismaSegmentUpdate(...args),
      count: (...args: unknown[]) => mockPrismaSegmentCount(...args),
      findMany: (...args: unknown[]) => mockPrismaSegmentFindMany(...args),
    },
    podcast: {
      update: (...args: unknown[]) => mockPrismaPodcastUpdate(...args),
      updateMany: (...args: unknown[]) => mockPrismaPodcastUpdateMany(...args),
      findUnique: (...args: unknown[]) => mockPrismaPodcastFindUnique(...args),
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaPodcastFindUniqueOrThrow(...args),
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
    podcastVoice: {
      upsert: (...args: unknown[]) => mockPrismaPodcastVoiceUpsert(...args),
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
  invalidatePodcastCache: vi.fn().mockResolvedValue(undefined),
  publishPodcastStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/byok', () => ({
  getByokKey: vi.fn().mockResolvedValue(null),
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
import { getCartesiaConcurrencyLimit, updateCartesiaConcurrencyFromError } from '@/lib/providers/tts/cartesia.provider';
import { getHumeConcurrencyLimit, updateHumeConcurrencyFromError } from '@/lib/providers/tts/hume.provider';
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
  podcastId: 'podcast-001',
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

describe('processAudioGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: segment has no existing audio
    mockPrismaSegmentFindUnique.mockResolvedValue(null);
    // Default: podcast not failed (fail-fast check passes)
    mockPrismaPodcastFindUnique.mockResolvedValue({ status: 'GENERATING_AUDIO' });
    mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
      userId: 'user-1',
      voices: [],
      ttsProvider: null,
      ttsModel: null,
      user: { plan: 'FREE' },
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
      'https://r2.example.com/podcasts/podcast-001/segments/segment-001.mp3'
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
      mockPrismaSegmentFindMany.mockResolvedValue([
        { id: 'seg-1' },
        { id: 'seg-2' },
      ]);

      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockPremiumGenerateSpeech).not.toHaveBeenCalled();
      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'audio-stitching' },
        'stitch_audio',
        { podcastId: 'podcast-001', segmentIds: ['seg-1', 'seg-2'] },
        { jobId: 'stitch-podcast-001' }
      );
      expect(mockPrismaPodcastUpdateMany).toHaveBeenCalledWith({
        where: { id: 'podcast-001', status: 'GENERATING_AUDIO' },
        data: { status: 'STITCHING' },
      });
    });
  });

  describe('podcast lookup', () => {
    it('fetches podcast voice configuration', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockPrismaPodcastFindUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        select: {
          userId: true,
          voices: { select: { speaker: true, voiceId: true, provider: true } },
          ttsProvider: true,
          ttsModel: true,
          user: { select: { plan: true } },
        },
      });
    });
  });

  describe('premium voice selection', () => {
    it('calls provider getVoiceId with speaker and podcastId for voice diversity', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockProviderGetVoiceId).toHaveBeenCalledWith('HOST', 'podcast-001', undefined);
    });

    it('passes HOST speaker to getVoiceId when speaker is HOST', async () => {
      const job = createMockJob({ ...defaultPayload, speaker: 'HOST' });
      await processAudioGeneration(job);

      expect(mockProviderGetVoiceId).toHaveBeenCalledWith('HOST', 'podcast-001', undefined);
    });

    it('passes EXPERT speaker to getVoiceId when speaker is EXPERT', async () => {
      const job = createMockJob({ ...defaultPayload, speaker: 'EXPERT' });
      await processAudioGeneration(job);

      expect(mockProviderGetVoiceId).toHaveBeenCalledWith('EXPERT', 'podcast-001', undefined);
    });

    it('uses custom hostVoiceId when set and provider matches', async () => {
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-1',
        voices: [
          { speaker: 'HOST', voiceId: 'custom-host-voice', provider: 'elevenlabs' },
        ],
        ttsProvider: null,
        ttsModel: null,
        user: { plan: 'FREE' },
      });
      const job = createMockJob({ ...defaultPayload, speaker: 'HOST' });
      await processAudioGeneration(job);

      expect(mockPremiumGenerateSpeech).toHaveBeenCalledWith(
        expect.objectContaining({ voiceId: 'custom-host-voice' })
      );
    });

    it('uses custom expertVoiceId when set and provider matches', async () => {
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-1',
        voices: [
          { speaker: 'EXPERT', voiceId: 'custom-expert-voice', provider: 'elevenlabs' },
        ],
        ttsProvider: null,
        ttsModel: null,
        user: { plan: 'FREE' },
      });
      const job = createMockJob({ ...defaultPayload, speaker: 'EXPERT' });
      await processAudioGeneration(job);

      expect(mockPremiumGenerateSpeech).toHaveBeenCalledWith(
        expect.objectContaining({ voiceId: 'custom-expert-voice' })
      );
    });

    it('falls back to pool when stored voice has wrong provider', async () => {
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-1',
        voices: [
          { speaker: 'HOST', voiceId: 'elevenlabs-voice-id', provider: 'elevenlabs' },
        ],
        ttsProvider: null,
        ttsModel: null,
        user: { plan: 'FREE' },
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

    it('falls back to pool when stored voice has null provider (legacy)', async () => {
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-1',
        voices: [
          { speaker: 'HOST', voiceId: 'old-voice-id', provider: null },
        ],
        ttsProvider: null,
        ttsModel: null,
        user: { plan: 'FREE' },
      });
      mockProviderGetVoiceId.mockReturnValue('pool-voice');
      const job = createMockJob({ ...defaultPayload, speaker: 'HOST' });
      await processAudioGeneration(job);

      expect(mockPremiumGenerateSpeech).toHaveBeenCalledWith(
        expect.objectContaining({ voiceId: 'pool-voice' })
      );
    });

    it('persists resolved voice when no PodcastVoice row exists', async () => {
      mockProviderGetVoiceId.mockReturnValue('pool-voice-xyz');
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockPrismaPodcastVoiceUpsert).toHaveBeenCalledWith({
        where: { podcastId_speaker: { podcastId: 'podcast-001', speaker: 'HOST' } },
        update: { voiceId: 'pool-voice-xyz', provider: 'elevenlabs' },
        create: { podcastId: 'podcast-001', speaker: 'HOST', voiceId: 'pool-voice-xyz', provider: 'elevenlabs' },
      });
    });

    it('persists resolved voice when provider mismatch', async () => {
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-1',
        voices: [
          { speaker: 'HOST', voiceId: 'old-elevenlabs-voice', provider: 'elevenlabs' },
        ],
        ttsProvider: null,
        ttsModel: null,
        user: { plan: 'FREE' },
      });
      setupHumeProvider();
      mockProviderGetVoiceId.mockReturnValue('hume-pool-voice');
      const job = createMockJob({ ...defaultPayload, speaker: 'HOST' });
      await processAudioGeneration(job);

      expect(mockPrismaPodcastVoiceUpsert).toHaveBeenCalledWith({
        where: { podcastId_speaker: { podcastId: 'podcast-001', speaker: 'HOST' } },
        update: { voiceId: 'hume-pool-voice', provider: 'hume' },
        create: { podcastId: 'podcast-001', speaker: 'HOST', voiceId: 'hume-pool-voice', provider: 'hume' },
      });
    });

    it('does not upsert when existing voice matches', async () => {
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-1',
        voices: [
          { speaker: 'HOST', voiceId: 'custom-host-voice', provider: 'elevenlabs' },
        ],
        ttsProvider: null,
        ttsModel: null,
        user: { plan: 'FREE' },
      });
      const job = createMockJob({ ...defaultPayload, speaker: 'HOST' });
      await processAudioGeneration(job);

      expect(mockPrismaPodcastVoiceUpsert).not.toHaveBeenCalled();
    });

    it('continues without error when upsert fails', async () => {
      mockPrismaPodcastVoiceUpsert.mockRejectedValue(new Error('DB constraint violation'));
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
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-1',
        voices: [],
        ttsProvider: null,
        ttsModel: null,
        user: { plan: 'FREE' },
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

      expect(mockStandardGetVoiceId).toHaveBeenCalledWith('HOST', 'podcast-001', undefined);
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
        'podcast-001',
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

      expect(mockGetAudioDuration).toHaveBeenCalledWith(
        expect.stringMatching(tmpProbeRegex)
      );
    });

    it('writes audio buffer to temp file for probing', async () => {
      const audioBuffer = Buffer.from('audio-data-for-probing');
      mockPremiumGenerateSpeech.mockResolvedValue(audioBuffer);
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringMatching(tmpProbeRegex),
        audioBuffer
      );
    });

    it('cleans up temp file after probing', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockRm).toHaveBeenCalledWith(
        expect.stringMatching(tmpProbeRegex),
        { force: true }
      );
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

      expect(mockRm).toHaveBeenCalledWith(
        expect.stringMatching(tmpProbeRegex),
        { force: true }
      );
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
      mockUploadSegmentAudio.mockResolvedValue('https://cdn.sotto.fm/segments/seg-001.mp3');
      mockGetAudioDuration.mockResolvedValue(7.89);
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockPrismaSegmentUpdate).toHaveBeenCalledWith({
        where: { id: 'segment-001' },
        data: { audioUrl: 'https://cdn.sotto.fm/segments/seg-001.mp3', duration: 7.89 },
      });
    });

    it('logs TTS cost to apiUsageLog', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockPrismaApiUsageLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          podcastId: 'podcast-001',
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

    it('checks the count of pending segments for this podcast', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockPrismaSegmentCount).toHaveBeenCalledWith({
        where: { podcastId: 'podcast-001', audioUrl: null },
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
        where: { podcastId: 'podcast-001' },
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

      expect(mockAddJob).toHaveBeenCalledWith({ name: 'audio-stitching' }, 'stitch_audio', {
        podcastId: 'podcast-001',
        segmentIds: ['seg-a', 'seg-b', 'seg-c'],
      }, { jobId: 'stitch-podcast-001' });
    });

    it('CAS-updates podcast status to STITCHING', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockPrismaPodcastUpdateMany).toHaveBeenCalledWith({
        where: { id: 'podcast-001', status: 'GENERATING_AUDIO' },
        data: { status: 'STITCHING' },
      });
    });

    it('queues stitching for a single-segment podcast', async () => {
      mockPrismaSegmentFindMany.mockResolvedValue([{ id: 'only-segment' }]);
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockAddJob).toHaveBeenCalledWith(
        expect.anything(),
        'stitch_audio',
        expect.objectContaining({ segmentIds: ['only-segment'] }),
        { jobId: 'stitch-podcast-001' }
      );
    });
  });

  describe('stitching queue (segments still pending)', () => {
    beforeEach(() => {
      mockPrismaSegmentCount.mockResolvedValue(3);
      // Set ttsProvider + ttsModel so the write-back update is skipped
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-1',
        voices: [],
        ttsProvider: 'elevenlabs',
        ttsModel: 'eleven_v3',
        user: { plan: 'FREE' },
      });
    });

    it('does not queue stitching when segments are still pending', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockAddJob).not.toHaveBeenCalled();
    });

    it('does not update podcast status when segments are still pending', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockPrismaPodcastUpdateMany).not.toHaveBeenCalled();
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
      expect(mockProviderGetVoiceId).toHaveBeenCalledWith('HOST', 'podcast-001', undefined);

      // Audio generated via premium provider
      expect(mockPremiumGenerateSpeech).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Welcome to the show!',
          voiceId: 'host-voice-id',
        })
      );

      // Uploaded to R2
      expect(mockUploadSegmentAudio).toHaveBeenCalledWith(
        'podcast-001',
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
      expect(mockPrismaPodcastUpdateMany).toHaveBeenCalledWith({
        where: { id: 'podcast-001', status: 'GENERATING_AUDIO' },
        data: { status: 'STITCHING' },
      });
    });

    it('executes the full pipeline for an EXPERT segment that is not the last', async () => {
      mockProviderGetVoiceId.mockReturnValue('expert-voice-id');
      mockPremiumGenerateSpeech.mockResolvedValue(Buffer.from('expert-audio'));
      mockUploadSegmentAudio.mockResolvedValue('https://r2.example.com/expert-audio.mp3');
      mockPrismaSegmentCount.mockResolvedValue(5);
      // Set ttsProvider + ttsModel so the write-back update is skipped
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-1',
        voices: [],
        ttsProvider: 'elevenlabs',
        ttsModel: 'eleven_v3',
        user: { plan: 'FREE' },
      });

      const job = createMockJob({
        podcastId: 'podcast-002',
        segmentId: 'segment-042',
        speaker: 'EXPERT',
        text: 'That is a great question, let me explain.',
      });
      await processAudioGeneration(job);

      // Voice selected for EXPERT via provider
      expect(mockProviderGetVoiceId).toHaveBeenCalledWith('EXPERT', 'podcast-002', undefined);

      // Audio generated via premium provider
      expect(mockPremiumGenerateSpeech).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'That is a great question, let me explain.',
          voiceId: 'expert-voice-id',
        })
      );

      // Uploaded
      expect(mockUploadSegmentAudio).toHaveBeenCalledWith(
        'podcast-002',
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
      expect(mockPrismaPodcastUpdateMany).not.toHaveBeenCalled();
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
        'podcast-001',
        expect.objectContaining({ tone: 'casual' })
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
        'podcast-001',
        expect.objectContaining({ tone: 'professional' })
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
        'podcast-001',
        expect.objectContaining({ tone: 'casual' })
      );
    });

    it('does not set tone when no directions match any pattern', async () => {
      mockPrismaScriptFindUnique.mockResolvedValue({
        turns: [
          { speaker: 'HOST', direction: 'neutral' },
          { speaker: 'EXPERT' },
        ],
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
        'podcast-001',
        undefined
      );
    });
  });

  describe('error propagation', () => {
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
      expect(semaphore.acquire).toHaveBeenCalledWith(
        expect.stringContaining('cartesia'),
        2
      );
      delete process.env.CARTESIA_API_KEY;
    });

    it('uses getHumeConcurrencyLimit for Hume provider', async () => {
      setupHumeProvider();
      process.env.HUME_API_KEY = 'test-hume-key';
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(getHumeConcurrencyLimit).toHaveBeenCalledWith('test-hume-key');
      expect(semaphore.acquire).toHaveBeenCalledWith(
        expect.stringContaining('hume'),
        5
      );
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

      expect(semaphore.acquire).toHaveBeenCalledWith(
        expect.stringContaining('openai'),
        5
      );
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

  describe('per-segment TTS override (showcase)', () => {
    const mockOverrideGenerateSpeech = vi.fn().mockResolvedValue(Buffer.from('override-audio'));
    const mockOverrideGetVoiceId = vi.fn().mockReturnValue('cartesia-voice-1');

    function setupSegmentOverride(overrides: { ttsProvider: string; ttsModel?: string; ttsVoiceId?: string }) {
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
        'cartesia', 'platform-cartesia-key', undefined, 'sonic-3'
      );
      expect(mockResolveTtsProvider).not.toHaveBeenCalled();
      expect(mockOverrideGenerateSpeech).toHaveBeenCalled();

      delete process.env.CARTESIA_API_KEY;
    });

    it('falls back to podcast-level flow when segment has no ttsProvider', async () => {
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

      expect(mockOverrideGetVoiceId).toHaveBeenCalledWith('HOST', 'podcast-001', undefined);
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

      expect(mockPrismaPodcastVoiceUpsert).toHaveBeenCalledWith({
        where: { podcastId_speaker: { podcastId: 'podcast-001', speaker: 'HOST' } },
        update: { voiceId: 'cart-voice-42', provider: 'cartesia' },
        create: { podcastId: 'podcast-001', speaker: 'HOST', voiceId: 'cart-voice-42', provider: 'cartesia' },
      });

      delete process.env.CARTESIA_API_KEY;
    });
  });
});
