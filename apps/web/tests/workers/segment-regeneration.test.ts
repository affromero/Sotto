import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks (must be declared before any import that touches the modules) ----

const mockPrismaSegmentCreate = vi.fn().mockResolvedValue({ id: 'segment-new-001' });
const mockPrismaSegmentUpdate = vi.fn().mockResolvedValue({});
const mockPrismaSegmentFindMany = vi.fn().mockResolvedValue([]);
const mockPrismaInteractionUpdate = vi.fn().mockResolvedValue({});
const mockPrismaPodcastUpdate = vi.fn().mockResolvedValue({});
const mockPrismaPodcastFindUniqueOrThrow = vi.fn().mockResolvedValue({
  userId: 'user-1',
  voices: [],
  ttsProvider: null,
  ttsModel: null,
});

const mockPrismaDiscoveryFindUnique = vi.fn().mockResolvedValue(null);
const mockPrismaVoiceTrackUpdateMany = vi.fn().mockResolvedValue({ count: 0 });

const mockPrismaTransaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
  const tx = {
    segment: {
      findMany: mockPrismaSegmentFindMany,
      update: mockPrismaSegmentUpdate,
      create: mockPrismaSegmentCreate,
    },
  };
  return callback(tx);
});

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    podcast: {
      update: (...args: unknown[]) => mockPrismaPodcastUpdate(...args),
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaPodcastFindUniqueOrThrow(...args),
    },
    segment: {
      create: (...args: unknown[]) => mockPrismaSegmentCreate(...args),
      update: (...args: unknown[]) => mockPrismaSegmentUpdate(...args),
      findMany: (...args: unknown[]) => mockPrismaSegmentFindMany(...args),
    },
    interaction: {
      update: (...args: unknown[]) => mockPrismaInteractionUpdate(...args),
    },
    discovery: {
      findUnique: (...args: unknown[]) => mockPrismaDiscoveryFindUnique(...args),
    },
    voiceTrack: {
      updateMany: (...args: unknown[]) => mockPrismaVoiceTrackUpdateMany(...args),
    },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => mockPrismaTransaction(fn),
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@/lib/elevenlabs', () => ({
  getVoiceId: vi.fn().mockReturnValue('voice-abc'),
  getVoiceProfile: vi.fn().mockReturnValue({}),
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

const mockGetAudioDuration = vi.fn().mockResolvedValue(5.5);

vi.mock('@/lib/audio-stitcher', () => ({
  getAudioDuration: (...args: unknown[]) => mockGetAudioDuration(...args),
}));

const mockAddJob = vi.fn().mockResolvedValue({ id: 'stitch-job-1' });

vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: {
    STITCH_AUDIO: 'stitch_audio',
  },
  audioStitchingQueue: { name: 'audio-stitching' },
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

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---- Import under test ----
import { processSegmentRegeneration } from '@/workers/segment-regeneration.worker';
import type { RegenerateSegmentPayload } from '@/lib/queue';
import type { Job } from 'bullmq';

// ---- Helpers ----

function createMockJob(data: RegenerateSegmentPayload): Job<RegenerateSegmentPayload> {
  return {
    data,
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<RegenerateSegmentPayload>;
}

const defaultPayload: RegenerateSegmentPayload = {
  podcastId: 'podcast-001',
  interactionId: 'interaction-001',
  insertAfterOrder: 3,
  newText: 'Great question! Let me expand on that.',
  speaker: 'EXPERT',
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

describe('processSegmentRegeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no custom voice IDs
    mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
      userId: 'user-1',
      voices: [],
      ttsProvider: null,
      ttsModel: null,
    });
    mockPrismaSegmentCreate.mockResolvedValue({ id: 'segment-new-001' });
    mockPrismaSegmentUpdate.mockResolvedValue({});
    mockPrismaSegmentFindMany.mockResolvedValue([
      { id: 'segment-001', order: 4 },
      { id: 'segment-002', order: 5 },
      { id: 'segment-003', order: 6 },
    ]);
    mockPrismaInteractionUpdate.mockResolvedValue({});
    mockPrismaPodcastUpdate.mockResolvedValue({});
    mockPremiumGenerateSpeech.mockResolvedValue(Buffer.from('fake-audio-data'));
    mockStandardGenerateSpeech.mockResolvedValue(Buffer.from('fake-audio-data'));
    mockUploadSegmentAudio.mockResolvedValue('https://r2.example.com/segments/segment-new-001.mp3');
    mockProviderGetVoiceId.mockReturnValue('voice-abc');
    mockStandardGetVoiceId.mockReturnValue('openai-voice-abc');
    mockGetAudioDuration.mockResolvedValue(5.5);
    // Default: premium provider via resolveTtsProvider
    setupPremiumProvider();
  });


  describe('premium voice selection', () => {
    it('calls provider getVoiceId with speaker and podcastId for voice diversity', async () => {
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(mockProviderGetVoiceId).toHaveBeenCalledWith('EXPERT', 'podcast-001', undefined);
    });

    it('passes HOST speaker to getVoiceId when speaker is HOST', async () => {
      const job = createMockJob({ ...defaultPayload, speaker: 'HOST' });
      await processSegmentRegeneration(job);

      expect(mockProviderGetVoiceId).toHaveBeenCalledWith('HOST', 'podcast-001', undefined);
    });

    it('uses custom hostVoiceId when set', async () => {
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-1',
        voices: [
          { speaker: 'HOST', voiceId: 'custom-host-voice' },
        ],
        ttsProvider: null,
        ttsModel: null,
      });
      const job = createMockJob({ ...defaultPayload, speaker: 'HOST' });
      await processSegmentRegeneration(job);

      expect(mockPremiumGenerateSpeech).toHaveBeenCalledWith(
        expect.objectContaining({ voiceId: 'custom-host-voice' })
      );
    });

    it('uses custom expertVoiceId when set', async () => {
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-1',
        voices: [
          { speaker: 'EXPERT', voiceId: 'custom-expert-voice' },
        ],
        ttsProvider: null,
        ttsModel: null,
      });
      const job = createMockJob({ ...defaultPayload, speaker: 'EXPERT' });
      await processSegmentRegeneration(job);

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
        newText: 'Let me clarify that point.',
        speaker: 'HOST',
      });
      await processSegmentRegeneration(job);

      expect(mockPremiumGenerateSpeech).toHaveBeenCalledWith({
        text: 'Let me clarify that point.',
        voiceId: 'voice-host-123',
      });
    });

    it('uses the voice ID returned by provider getVoiceId', async () => {
      mockProviderGetVoiceId.mockReturnValue('custom-expert-voice');
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(mockPremiumGenerateSpeech).toHaveBeenCalledWith(
        expect.objectContaining({ voiceId: 'custom-expert-voice' })
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
      });
      setupStandardProvider();
    });

    it('uses standard TTS provider when no custom provider is set', async () => {
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(mockStandardGenerateSpeech).toHaveBeenCalled();
      expect(mockPremiumGenerateSpeech).not.toHaveBeenCalled();
    });

    it('uses standard provider getVoiceId', async () => {
      mockStandardGetVoiceId.mockReturnValue('openai-voice-xyz');
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(mockStandardGetVoiceId).toHaveBeenCalledWith('EXPERT', 'podcast-001', undefined);
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
      await processSegmentRegeneration(job);

      expect(mockUploadSegmentAudio).toHaveBeenCalledWith(
        'podcast-001',
        expect.stringContaining('regen-'),
        audioBuffer
      );
    });

    it('passes the exact buffer returned by generateSpeech to R2', async () => {
      const specificBuffer = Buffer.from('specific-audio-content-xyz');
      mockPremiumGenerateSpeech.mockResolvedValue(specificBuffer);
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      const uploadedBuffer = mockUploadSegmentAudio.mock.calls[0][2];
      expect(uploadedBuffer).toBe(specificBuffer);
    });
  });

  describe('FFprobe duration extraction', () => {
    it('estimates duration from text when FFprobe fails', async () => {
      mockGetAudioDuration.mockRejectedValue(new Error('FFprobe failed'));
      const job = createMockJob({
        ...defaultPayload,
        newText: 'A'.repeat(125), // 125 chars → 10 seconds at ~12.5 chars/sec
      });
      await processSegmentRegeneration(job);

      expect(mockPrismaSegmentCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          duration: 10,
        }),
      });
    });

  });

  describe('transaction segment reordering', () => {
    it('shifts all segments with order > insertAfterOrder up by 1', async () => {
      mockPrismaSegmentFindMany.mockResolvedValue([
        { id: 'segment-006', order: 6 },
        { id: 'segment-005', order: 5 },
        { id: 'segment-004', order: 4 },
      ]);
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(mockPrismaSegmentUpdate).toHaveBeenCalledWith({
        where: { id: 'segment-006' },
        data: { order: 7 },
      });
      expect(mockPrismaSegmentUpdate).toHaveBeenCalledWith({
        where: { id: 'segment-005' },
        data: { order: 6 },
      });
      expect(mockPrismaSegmentUpdate).toHaveBeenCalledWith({
        where: { id: 'segment-004' },
        data: { order: 5 },
      });
    });

    it('creates new segment at insertAfterOrder + 1', async () => {
      const job = createMockJob({ ...defaultPayload, insertAfterOrder: 5 });
      await processSegmentRegeneration(job);

      expect(mockPrismaSegmentCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ order: 6 }),
      });
    });

    it('creates segment at order 1 when insertAfterOrder is 0', async () => {
      const job = createMockJob({ ...defaultPayload, insertAfterOrder: 0 });
      await processSegmentRegeneration(job);

      expect(mockPrismaSegmentCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ order: 1 }),
      });
    });

    it('includes duration from FFprobe in segment creation', async () => {
      mockGetAudioDuration.mockResolvedValue(7.3);
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(mockPrismaSegmentCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ duration: 7.3 }),
      });
    });
  });

  describe('interaction status update', () => {
    it('marks the interaction as INCORPORATED', async () => {
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(mockPrismaInteractionUpdate).toHaveBeenCalledWith({
        where: { id: 'interaction-001' },
        data: { status: 'INCORPORATED', incorporated: true },
      });
    });

    it('uses the interaction ID from the payload', async () => {
      const job = createMockJob({ ...defaultPayload, interactionId: 'interaction-xyz' });
      await processSegmentRegeneration(job);

      expect(mockPrismaInteractionUpdate).toHaveBeenCalledWith({
        where: { id: 'interaction-xyz' },
        data: { status: 'INCORPORATED', incorporated: true },
      });
    });
  });

  describe('podcast status update', () => {
    it('updates podcast status to STITCHING after regeneration', async () => {
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: { status: 'STITCHING' },
      });
    });

    it('uses the podcast ID from the payload', async () => {
      const job = createMockJob({ ...defaultPayload, podcastId: 'podcast-xyz' });
      await processSegmentRegeneration(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-xyz' },
        data: { status: 'STITCHING' },
      });
    });
  });

  describe('re-stitch queue', () => {
    it('queues a re-stitch job with skipSfx flag', async () => {
      mockPrismaSegmentFindMany
        .mockResolvedValueOnce([
          { id: 'segment-004', order: 4 },
          { id: 'segment-005', order: 5 },
          { id: 'segment-006', order: 6 },
        ])
        .mockResolvedValueOnce([{ id: 'segment-a' }, { id: 'segment-b' }, { id: 'segment-c' }]);
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(mockAddJob).toHaveBeenCalledWith({ name: 'audio-stitching' }, 'stitch_audio', {
        podcastId: 'podcast-001',
        segmentIds: ['segment-a', 'segment-b', 'segment-c'],
        skipSfx: true,
      });
    });

    it('includes all segment IDs in the re-stitch job', async () => {
      mockPrismaSegmentFindMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { id: 'seg-1' },
          { id: 'seg-2' },
          { id: 'seg-3' },
          { id: 'seg-4' },
        ]);
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(mockAddJob).toHaveBeenCalledWith(
        expect.anything(),
        'stitch_audio',
        expect.objectContaining({ segmentIds: ['seg-1', 'seg-2', 'seg-3', 'seg-4'] })
      );
    });
  });

  describe('job progress updates', () => {
    it('reports monotonically increasing progress ending at 100', async () => {
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      const calls = (job.updateProgress as ReturnType<typeof vi.fn>).mock.calls.map((c: any[]) => c[0]);
      for (let i = 1; i < calls.length; i++) {
        expect(calls[i]).toBeGreaterThanOrEqual(calls[i - 1]);
      }
      expect(calls[calls.length - 1]).toBe(100);
    });
  });

  describe('end-to-end flow', () => {
    it('executes the full regeneration pipeline for HOST segment (premium voice)', async () => {
      mockProviderGetVoiceId.mockReturnValue('host-voice-id');
      mockPremiumGenerateSpeech.mockResolvedValue(Buffer.from('host-audio'));
      mockUploadSegmentAudio.mockResolvedValue('https://r2.example.com/host-audio.mp3');
      mockGetAudioDuration.mockResolvedValue(6.2);
      mockPrismaSegmentFindMany
        .mockResolvedValueOnce([
          { id: 'segment-002', order: 2 },
          { id: 'segment-001', order: 1 },
        ])
        .mockResolvedValueOnce([
          { id: 'segment-001' },
          { id: 'segment-new-host' },
          { id: 'segment-002' },
        ]);

      const job = createMockJob({
        podcastId: 'podcast-001',
        interactionId: 'interaction-001',
        insertAfterOrder: 0,
        newText: 'Let me explain that further.',
        speaker: 'HOST',
      });
      await processSegmentRegeneration(job);

      // Podcast fetched
      expect(mockPrismaPodcastFindUniqueOrThrow).toHaveBeenCalled();

      // Voice selected via provider
      expect(mockProviderGetVoiceId).toHaveBeenCalledWith('HOST', 'podcast-001', undefined);

      // Audio generated via premium provider
      expect(mockPremiumGenerateSpeech).toHaveBeenCalledWith({
        text: 'Let me explain that further.',
        voiceId: 'host-voice-id',
      });

      // Uploaded to R2
      expect(mockUploadSegmentAudio).toHaveBeenCalledWith(
        'podcast-001',
        expect.stringContaining('regen-'),
        Buffer.from('host-audio')
      );

      // FFprobe duration extracted
      expect(mockGetAudioDuration).toHaveBeenCalled();

      // Segments shifted and new segment created
      expect(mockPrismaSegmentCreate).toHaveBeenCalledWith({
        data: {
          podcastId: 'podcast-001',
          speaker: 'HOST',
          text: 'Let me explain that further.',
          audioUrl: 'https://r2.example.com/host-audio.mp3',
          duration: 6.2,
          order: 1,
        },
      });

      // Interaction marked as incorporated
      expect(mockPrismaInteractionUpdate).toHaveBeenCalledWith({
        where: { id: 'interaction-001' },
        data: { status: 'INCORPORATED', incorporated: true },
      });

      // Re-stitch queued with skipSfx
      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'audio-stitching' },
        'stitch_audio',
        expect.objectContaining({ skipSfx: true })
      );

      // Podcast status updated to STITCHING
      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: { status: 'STITCHING' },
      });
    });

    it('executes the full regeneration pipeline for EXPERT segment (standard voice)', async () => {
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-1',
        voices: [],
        ttsProvider: null,
        ttsModel: null,
      });
      setupStandardProvider();
      mockStandardGetVoiceId.mockReturnValue('openai-expert-voice');
      mockStandardGenerateSpeech.mockResolvedValue(Buffer.from('expert-audio'));
      mockUploadSegmentAudio.mockResolvedValue('https://r2.example.com/expert-audio.mp3');
      mockGetAudioDuration.mockResolvedValue(8.1);
      mockPrismaSegmentFindMany
        .mockResolvedValueOnce([
          { id: 'segment-006', order: 6 },
          { id: 'segment-005', order: 5 },
        ])
        .mockResolvedValueOnce([
          { id: 'segment-001' },
          { id: 'segment-002' },
          { id: 'segment-new-expert' },
        ]);

      const job = createMockJob({
        podcastId: 'podcast-002',
        interactionId: 'interaction-002',
        insertAfterOrder: 4,
        newText: 'That is a great observation.',
        speaker: 'EXPERT',
      });
      await processSegmentRegeneration(job);

      // Voice selected for EXPERT via standard provider
      expect(mockStandardGetVoiceId).toHaveBeenCalledWith('EXPERT', 'podcast-002', undefined);

      // Audio generated via standard provider
      expect(mockStandardGenerateSpeech).toHaveBeenCalledWith({
        text: 'That is a great observation.',
        voiceId: 'openai-expert-voice',
      });

      // Premium provider not used
      expect(mockPremiumGenerateSpeech).not.toHaveBeenCalled();

      // Segment created with FFprobe duration
      expect(mockPrismaSegmentCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          duration: 8.1,
          speaker: 'EXPERT',
        }),
      });

      // Interaction marked incorporated
      expect(mockPrismaInteractionUpdate).toHaveBeenCalledWith({
        where: { id: 'interaction-002' },
        data: { status: 'INCORPORATED', incorporated: true },
      });

      // Re-stitch queued
      expect(mockAddJob).toHaveBeenCalled();

      // Podcast status to STITCHING
      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-002' },
        data: { status: 'STITCHING' },
      });
    });
  });

  describe('error propagation', () => {
    it('propagates errors from podcast lookup', async () => {
      mockPrismaPodcastFindUniqueOrThrow.mockRejectedValue(new Error('Podcast not found'));
      const job = createMockJob(defaultPayload);

      await expect(processSegmentRegeneration(job)).rejects.toThrow('Podcast not found');
    });

    it('propagates errors from premium generateSpeech', async () => {
      mockPremiumGenerateSpeech.mockRejectedValue(
        new Error('ElevenLabs API error (429): rate limited')
      );
      const job = createMockJob(defaultPayload);

      await expect(processSegmentRegeneration(job)).rejects.toThrow(
        'ElevenLabs API error (429): rate limited'
      );
    });

    it('propagates errors from standard generateSpeech', async () => {
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-1',
        voices: [],
        ttsProvider: null,
        ttsModel: null,
      });
      setupStandardProvider();
      mockStandardGenerateSpeech.mockRejectedValue(new Error('OpenAI TTS error'));
      const job = createMockJob(defaultPayload);

      await expect(processSegmentRegeneration(job)).rejects.toThrow('OpenAI TTS error');
    });

    it('propagates errors from uploadSegmentAudio', async () => {
      mockUploadSegmentAudio.mockRejectedValue(new Error('R2 storage not configured'));
      const job = createMockJob(defaultPayload);

      await expect(processSegmentRegeneration(job)).rejects.toThrow('R2 storage not configured');
    });

    it('propagates errors from transaction segment creation', async () => {
      mockPrismaSegmentCreate.mockRejectedValue(new Error('Database connection failed'));
      const job = createMockJob(defaultPayload);

      await expect(processSegmentRegeneration(job)).rejects.toThrow('Database connection failed');
    });

    it('propagates errors from interaction update', async () => {
      mockPrismaInteractionUpdate.mockRejectedValue(new Error('Interaction does not exist'));
      const job = createMockJob(defaultPayload);

      await expect(processSegmentRegeneration(job)).rejects.toThrow('Interaction does not exist');
    });

    it('propagates errors from podcast update', async () => {
      mockPrismaPodcastUpdate.mockRejectedValue(new Error('Podcast update failed'));
      const job = createMockJob(defaultPayload);

      await expect(processSegmentRegeneration(job)).rejects.toThrow('Podcast update failed');
    });

    it('propagates errors from addJob', async () => {
      mockAddJob.mockRejectedValue(new Error('Queue connection lost'));
      const job = createMockJob(defaultPayload);

      await expect(processSegmentRegeneration(job)).rejects.toThrow('Queue connection lost');
    });
  });
});
