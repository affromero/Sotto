import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks (must be declared before any import that touches the modules) ----

const mockPrismaSegmentCreate = vi.fn().mockResolvedValue({ id: 'segment-new-001' });
const mockPrismaSegmentUpdate = vi.fn().mockResolvedValue({});
const mockPrismaSegmentFindMany = vi.fn().mockResolvedValue([]);
const mockPrismaInteractionUpdate = vi.fn().mockResolvedValue({});
const mockPrismaPodcastUpdate = vi.fn().mockResolvedValue({});
const mockPrismaPodcastFindUniqueOrThrow = vi.fn().mockResolvedValue({
  usePremiumVoice: true,
  hostVoiceId: null,
  expertVoiceId: null,
});

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

vi.mock('@/lib/prisma', () => ({
  prisma: {
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
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => mockPrismaTransaction(fn),
  },
}));

const mockGetVoiceId = vi.fn().mockReturnValue('voice-abc');
const mockGetVoiceProfile = vi.fn().mockReturnValue({
  id: 'voice-abc',
  name: 'Adam',
  gender: 'male',
  accent: 'american',
  ageRange: 'middle',
  character: 'warm narrator',
});

vi.mock('@/lib/elevenlabs', () => ({
  getVoiceId: (...args: unknown[]) => mockGetVoiceId(...args),
  getVoiceProfile: (...args: unknown[]) => mockGetVoiceProfile(...args),
}));

const mockPremiumGenerateSpeech = vi.fn().mockResolvedValue(Buffer.from('fake-audio'));
const mockStandardGenerateSpeech = vi.fn().mockResolvedValue(Buffer.from('fake-audio'));
const mockStandardGetVoiceId = vi.fn().mockReturnValue('openai-voice-abc');

vi.mock('@/lib/providers', () => ({
  createPremiumTtsProvider: () => ({
    generateSpeech: (...args: unknown[]) => mockPremiumGenerateSpeech(...args),
  }),
  createTtsProvider: () => ({
    generateSpeech: (...args: unknown[]) => mockStandardGenerateSpeech(...args),
    getVoiceId: (...args: unknown[]) => mockStandardGetVoiceId(...args),
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

// ---- Tests ----

describe('processSegmentRegeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: premium voice, no custom voice IDs
    mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
      usePremiumVoice: true,
      hostVoiceId: null,
      expertVoiceId: null,
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
    mockGetVoiceId.mockReturnValue('voice-abc');
    mockGetVoiceProfile.mockReturnValue({
      id: 'voice-abc',
      name: 'Adam',
      gender: 'male',
      accent: 'american',
      ageRange: 'middle',
      character: 'warm narrator',
    });
    mockGetAudioDuration.mockResolvedValue(5.5);
  });

  describe('podcast lookup', () => {
    it('fetches podcast voice configuration', async () => {
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(mockPrismaPodcastFindUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        select: { usePremiumVoice: true, hostVoiceId: true, expertVoiceId: true },
      });
    });
  });

  describe('premium voice selection', () => {
    it('calls getVoiceId with speaker and podcastId for voice diversity', async () => {
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(mockGetVoiceId).toHaveBeenCalledWith('EXPERT', 'podcast-001');
    });

    it('passes HOST speaker to getVoiceId when speaker is HOST', async () => {
      const job = createMockJob({ ...defaultPayload, speaker: 'HOST' });
      await processSegmentRegeneration(job);

      expect(mockGetVoiceId).toHaveBeenCalledWith('HOST', 'podcast-001');
    });

    it('passes EXPERT speaker to getVoiceId when speaker is EXPERT', async () => {
      const job = createMockJob({ ...defaultPayload, speaker: 'EXPERT' });
      await processSegmentRegeneration(job);

      expect(mockGetVoiceId).toHaveBeenCalledWith('EXPERT', 'podcast-001');
    });

    it('calls getVoiceProfile with the returned voiceId', async () => {
      mockGetVoiceId.mockReturnValue('voice-xyz');
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(mockGetVoiceProfile).toHaveBeenCalledWith('voice-xyz');
    });

    it('uses custom hostVoiceId when set', async () => {
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        usePremiumVoice: true,
        hostVoiceId: 'custom-host-voice',
        expertVoiceId: null,
      });
      const job = createMockJob({ ...defaultPayload, speaker: 'HOST' });
      await processSegmentRegeneration(job);

      expect(mockPremiumGenerateSpeech).toHaveBeenCalledWith(
        expect.objectContaining({ voiceId: 'custom-host-voice' })
      );
    });

    it('uses custom expertVoiceId when set', async () => {
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        usePremiumVoice: true,
        hostVoiceId: null,
        expertVoiceId: 'custom-expert-voice',
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
      mockGetVoiceId.mockReturnValue('voice-host-123');
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

    it('uses the voice ID returned by getVoiceId', async () => {
      mockGetVoiceId.mockReturnValue('custom-expert-voice');
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
        usePremiumVoice: false,
        hostVoiceId: null,
        expertVoiceId: null,
      });
    });

    it('uses standard TTS provider when usePremiumVoice is false', async () => {
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(mockStandardGenerateSpeech).toHaveBeenCalled();
      expect(mockPremiumGenerateSpeech).not.toHaveBeenCalled();
    });

    it('uses standard provider getVoiceId', async () => {
      mockStandardGetVoiceId.mockReturnValue('openai-voice-xyz');
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(mockStandardGetVoiceId).toHaveBeenCalledWith('EXPERT', 'podcast-001');
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
    it('writes audio buffer to temp file for FFprobe', async () => {
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('sotto-regen-probe-'),
        expect.any(Buffer)
      );
    });

    it('calls getAudioDuration with temp file path', async () => {
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(mockGetAudioDuration).toHaveBeenCalledWith(
        expect.stringContaining('sotto-regen-probe-')
      );
    });

    it('cleans up temp file after FFprobe', async () => {
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(mockRm).toHaveBeenCalledWith(expect.stringContaining('sotto-regen-probe-'), {
        force: true,
      });
    });

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

    it('still cleans up temp file when FFprobe fails', async () => {
      mockGetAudioDuration.mockRejectedValue(new Error('FFprobe failed'));
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(mockRm).toHaveBeenCalledWith(expect.stringContaining('sotto-regen-probe-'), {
        force: true,
      });
    });
  });

  describe('transaction segment reordering', () => {
    it('queries segments with order > insertAfterOrder in descending order', async () => {
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(mockPrismaSegmentFindMany).toHaveBeenCalledWith({
        where: { podcastId: 'podcast-001', order: { gt: 3 } },
        orderBy: { order: 'desc' },
        select: { id: true, order: true },
      });
    });

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
    it('queries all segments ordered by order ascending', async () => {
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(mockPrismaSegmentFindMany).toHaveBeenCalledWith({
        where: { podcastId: 'podcast-001' },
        orderBy: { order: 'asc' },
        select: { id: true },
      });
    });

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
    it('reports progress at 10% after starting', async () => {
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(job.updateProgress).toHaveBeenCalledWith(10);
    });

    it('reports progress at 40% after TTS generation', async () => {
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(job.updateProgress).toHaveBeenCalledWith(40);
    });

    it('reports progress at 60% after R2 upload', async () => {
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(job.updateProgress).toHaveBeenCalledWith(60);
    });

    it('reports progress at 75% after segment insertion', async () => {
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(job.updateProgress).toHaveBeenCalledWith(75);
    });

    it('reports progress at 100% at the end', async () => {
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(job.updateProgress).toHaveBeenCalledWith(100);
    });

    it('reports progress in the correct order', async () => {
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      const progressCalls = (job.updateProgress as ReturnType<typeof vi.fn>).mock.calls.map(
        (call: number[]) => call[0]
      );
      expect(progressCalls).toEqual([10, 40, 60, 75, 100]);
    });
  });

  describe('end-to-end flow', () => {
    it('executes the full regeneration pipeline for HOST segment (premium voice)', async () => {
      mockGetVoiceId.mockReturnValue('host-voice-id');
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
      expect(mockPrismaPodcastFindUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        select: { usePremiumVoice: true, hostVoiceId: true, expertVoiceId: true },
      });

      // Voice selected
      expect(mockGetVoiceId).toHaveBeenCalledWith('HOST', 'podcast-001');

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
        usePremiumVoice: false,
        hostVoiceId: null,
        expertVoiceId: null,
      });
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
      expect(mockStandardGetVoiceId).toHaveBeenCalledWith('EXPERT', 'podcast-002');

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
        usePremiumVoice: false,
        hostVoiceId: null,
        expertVoiceId: null,
      });
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
