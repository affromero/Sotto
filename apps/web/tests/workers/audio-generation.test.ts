import os from 'os';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks (must be declared before any import that touches the modules) ----

const mockPrismaSegmentFindUnique = vi.fn().mockResolvedValue(null);
const mockPrismaSegmentUpdate = vi.fn().mockResolvedValue({});
const mockPrismaSegmentCount = vi.fn().mockResolvedValue(0);
const mockPrismaSegmentFindMany = vi.fn().mockResolvedValue([]);
const mockPrismaPodcastUpdate = vi.fn().mockResolvedValue({});
const mockPrismaPodcastFindUniqueOrThrow = vi.fn().mockResolvedValue({
  userId: 'user-1',
  hostVoiceId: null,
  expertVoiceId: null,
  ttsProvider: null,
});
const mockPrismaApiUsageLogCreate = vi.fn().mockResolvedValue({});

vi.mock('@/lib/prisma', () => ({
  prisma: {
    segment: {
      findUnique: (...args: unknown[]) => mockPrismaSegmentFindUnique(...args),
      update: (...args: unknown[]) => mockPrismaSegmentUpdate(...args),
      count: (...args: unknown[]) => mockPrismaSegmentCount(...args),
      findMany: (...args: unknown[]) => mockPrismaSegmentFindMany(...args),
    },
    podcast: {
      update: (...args: unknown[]) => mockPrismaPodcastUpdate(...args),
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaPodcastFindUniqueOrThrow(...args),
    },
    apiUsageLog: {
      create: (...args: unknown[]) => mockPrismaApiUsageLogCreate(...args),
    },
  },
}));

vi.mock('@/lib/elevenlabs', () => ({
  getVoiceId: vi.fn().mockReturnValue('voice-abc'),
  getVoiceProfile: vi.fn().mockReturnValue({}),
  getElevenLabsPerKCharRate: vi.fn().mockReturnValue(0.3),
  getOpenAiPerKCharRate: vi.fn().mockReturnValue(0.03),
}));

const mockPremiumGenerateSpeech = vi.fn().mockResolvedValue(Buffer.from('fake-audio'));
const mockStandardGenerateSpeech = vi.fn().mockResolvedValue(Buffer.from('fake-audio'));
const mockProviderGetVoiceId = vi.fn().mockReturnValue('voice-abc');
const mockStandardGetVoiceId = vi.fn().mockReturnValue('openai-voice-abc');

const mockResolveTtsProvider = vi.fn();

vi.mock('@/lib/providers', () => ({
  resolveTtsProvider: (...args: unknown[]) => mockResolveTtsProvider(...args),
  createPremiumTtsProvider: vi.fn(),
  createTtsProvider: vi.fn(),
  createTtsProviderAsync: vi.fn(),
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

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---- Import under test ----
import { processAudioGeneration } from '@/workers/audio-generation.worker';
import type { GenerateAudioPayload } from '@/lib/queue';
import type { Job } from 'bullmq';

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
      providerId: 'openai',
    },
    source: 'platform',
    providerId: 'openai',
  });
}

// ---- Tests ----

describe('processAudioGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: segment has no existing audio
    mockPrismaSegmentFindUnique.mockResolvedValue(null);
    mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
      userId: 'user-1',
      hostVoiceId: null,
      expertVoiceId: null,
      ttsProvider: null,
    });
    // Default: no pending segments (all done)
    mockPrismaSegmentCount.mockResolvedValue(0);
    mockPrismaSegmentFindMany.mockResolvedValue([{ id: 'segment-001' }, { id: 'segment-002' }]);
    mockPremiumGenerateSpeech.mockResolvedValue(Buffer.from('fake-audio-data'));
    mockStandardGenerateSpeech.mockResolvedValue(Buffer.from('fake-audio-data'));
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
        { podcastId: 'podcast-001', segmentIds: ['seg-1', 'seg-2'] }
      );
      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
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
          hostVoiceId: true,
          expertVoiceId: true,
          ttsProvider: true,
        },
      });
    });
  });

  describe('premium voice selection', () => {
    it('calls provider getVoiceId with speaker and podcastId for voice diversity', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockProviderGetVoiceId).toHaveBeenCalledWith('HOST', 'podcast-001');
    });

    it('passes HOST speaker to getVoiceId when speaker is HOST', async () => {
      const job = createMockJob({ ...defaultPayload, speaker: 'HOST' });
      await processAudioGeneration(job);

      expect(mockProviderGetVoiceId).toHaveBeenCalledWith('HOST', 'podcast-001');
    });

    it('passes EXPERT speaker to getVoiceId when speaker is EXPERT', async () => {
      const job = createMockJob({ ...defaultPayload, speaker: 'EXPERT' });
      await processAudioGeneration(job);

      expect(mockProviderGetVoiceId).toHaveBeenCalledWith('EXPERT', 'podcast-001');
    });

    it('uses custom hostVoiceId when set', async () => {
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-1',
        hostVoiceId: 'custom-host-voice',
        expertVoiceId: null,
        ttsProvider: null,
      });
      const job = createMockJob({ ...defaultPayload, speaker: 'HOST' });
      await processAudioGeneration(job);

      expect(mockPremiumGenerateSpeech).toHaveBeenCalledWith(
        expect.objectContaining({ voiceId: 'custom-host-voice' })
      );
    });

    it('uses custom expertVoiceId when set', async () => {
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-1',
        hostVoiceId: null,
        expertVoiceId: 'custom-expert-voice',
        ttsProvider: null,
      });
      const job = createMockJob({ ...defaultPayload, speaker: 'EXPERT' });
      await processAudioGeneration(job);

      expect(mockPremiumGenerateSpeech).toHaveBeenCalledWith(
        expect.objectContaining({ voiceId: 'custom-expert-voice' })
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

      expect(mockPremiumGenerateSpeech).toHaveBeenCalledWith({
        text: 'This is a test segment.',
        voiceId: 'voice-host-123',
      });
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
        hostVoiceId: null,
        expertVoiceId: null,
        ttsProvider: null,
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

      expect(mockStandardGetVoiceId).toHaveBeenCalledWith('HOST', 'podcast-001');
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

    it('queues a stitching job with all segment IDs', async () => {
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
      });
    });

    it('updates podcast status to STITCHING', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
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
        expect.objectContaining({ segmentIds: ['only-segment'] })
      );
    });
  });

  describe('stitching queue (segments still pending)', () => {
    beforeEach(() => {
      mockPrismaSegmentCount.mockResolvedValue(3);
      // Set ttsProvider so the write-back update is skipped
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-1',
        hostVoiceId: null,
        expertVoiceId: null,
        ttsProvider: 'elevenlabs',
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

      expect(mockPrismaPodcastUpdate).not.toHaveBeenCalled();
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
      expect(mockProviderGetVoiceId).toHaveBeenCalledWith('HOST', 'podcast-001');

      // Audio generated via premium provider
      expect(mockPremiumGenerateSpeech).toHaveBeenCalledWith({
        text: 'Welcome to the show!',
        voiceId: 'host-voice-id',
      });

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

      // Stitching queued (last segment)
      expect(mockAddJob).toHaveBeenCalled();
      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: { status: 'STITCHING' },
      });
    });

    it('executes the full pipeline for an EXPERT segment that is not the last', async () => {
      mockProviderGetVoiceId.mockReturnValue('expert-voice-id');
      mockPremiumGenerateSpeech.mockResolvedValue(Buffer.from('expert-audio'));
      mockUploadSegmentAudio.mockResolvedValue('https://r2.example.com/expert-audio.mp3');
      mockPrismaSegmentCount.mockResolvedValue(5);
      // Set ttsProvider so the write-back update is skipped
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-1',
        hostVoiceId: null,
        expertVoiceId: null,
        ttsProvider: 'elevenlabs',
      });

      const job = createMockJob({
        podcastId: 'podcast-002',
        segmentId: 'segment-042',
        speaker: 'EXPERT',
        text: 'That is a great question, let me explain.',
      });
      await processAudioGeneration(job);

      // Voice selected for EXPERT via provider
      expect(mockProviderGetVoiceId).toHaveBeenCalledWith('EXPERT', 'podcast-002');

      // Audio generated via premium provider
      expect(mockPremiumGenerateSpeech).toHaveBeenCalledWith({
        text: 'That is a great question, let me explain.',
        voiceId: 'expert-voice-id',
      });

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
      expect(mockPrismaPodcastUpdate).not.toHaveBeenCalled();
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
});
