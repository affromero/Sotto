import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks (must be declared before any import that touches the modules) ----

const mockPrismaSegmentCreate = vi.fn().mockResolvedValue({ id: 'segment-new-001' });
const mockPrismaSegmentUpdate = vi.fn().mockResolvedValue({});
const mockPrismaSegmentFindMany = vi.fn().mockResolvedValue([]);
const mockPrismaInteractionUpdate = vi.fn().mockResolvedValue({});
const mockPrismaPodcastUpdate = vi.fn().mockResolvedValue({});

vi.mock('@/lib/prisma', () => ({
  prisma: {
    segment: {
      create: (...args: unknown[]) => mockPrismaSegmentCreate(...args),
      update: (...args: unknown[]) => mockPrismaSegmentUpdate(...args),
      findMany: (...args: unknown[]) => mockPrismaSegmentFindMany(...args),
    },
    interaction: {
      update: (...args: unknown[]) => mockPrismaInteractionUpdate(...args),
    },
    podcast: {
      update: (...args: unknown[]) => mockPrismaPodcastUpdate(...args),
    },
  },
}));

const mockGetVoiceId = vi.fn().mockReturnValue('voice-abc');

vi.mock('@/lib/elevenlabs', () => ({
  getVoiceId: (...args: unknown[]) => mockGetVoiceId(...args),
  generateSpeech: vi.fn().mockResolvedValue(Buffer.from('fake-audio')),
}));

const mockGenerateSpeech = vi.fn().mockResolvedValue(Buffer.from('fake-audio-data'));

vi.mock('@/lib/elevenlabs', () => ({
  getVoiceId: (...args: unknown[]) => mockGetVoiceId(...args),
  generateSpeech: (...args: unknown[]) => mockGenerateSpeech(...args),
}));

const mockUploadSegmentAudio = vi.fn().mockResolvedValue('https://r2.example.com/audio.mp3');

vi.mock('@/lib/r2', () => ({
  uploadSegmentAudio: (...args: unknown[]) => mockUploadSegmentAudio(...args),
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
    mockPrismaSegmentCreate.mockResolvedValue({ id: 'segment-new-001' });
    mockPrismaSegmentUpdate.mockResolvedValue({});
    mockPrismaSegmentFindMany.mockResolvedValue([
      { id: 'segment-001', order: 0 },
      { id: 'segment-002', order: 1 },
      { id: 'segment-003', order: 2 },
      { id: 'segment-new-001', order: 3.5 },
      { id: 'segment-004', order: 4 },
    ]);
    mockPrismaInteractionUpdate.mockResolvedValue({});
    mockPrismaPodcastUpdate.mockResolvedValue({});
    mockGenerateSpeech.mockResolvedValue(Buffer.from('fake-audio-data'));
    mockUploadSegmentAudio.mockResolvedValue('https://r2.example.com/segments/segment-new-001.mp3');
    mockGetVoiceId.mockReturnValue('voice-abc');
  });

  describe('segment creation', () => {
    it('creates a new segment with correct podcast ID', async () => {
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(mockPrismaSegmentCreate).toHaveBeenCalledWith({
        data: {
          podcastId: 'podcast-001',
          speaker: 'EXPERT',
          text: 'Great question! Let me expand on that.',
          order: 3.5,
        },
      });
    });

    it('inserts segment at insertAfterOrder + 0.5', async () => {
      const job = createMockJob({ ...defaultPayload, insertAfterOrder: 5 });
      await processSegmentRegeneration(job);

      expect(mockPrismaSegmentCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ order: 5.5 }),
      });
    });

    it('inserts segment at order 0.5 when insertAfterOrder is 0', async () => {
      const job = createMockJob({ ...defaultPayload, insertAfterOrder: 0 });
      await processSegmentRegeneration(job);

      expect(mockPrismaSegmentCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ order: 0.5 }),
      });
    });

    it('creates segment with HOST speaker when specified', async () => {
      const job = createMockJob({ ...defaultPayload, speaker: 'HOST' });
      await processSegmentRegeneration(job);

      expect(mockPrismaSegmentCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ speaker: 'HOST' }),
      });
    });

    it('creates segment with EXPERT speaker when specified', async () => {
      const job = createMockJob({ ...defaultPayload, speaker: 'EXPERT' });
      await processSegmentRegeneration(job);

      expect(mockPrismaSegmentCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ speaker: 'EXPERT' }),
      });
    });

    it('creates segment with the provided text', async () => {
      const job = createMockJob({
        ...defaultPayload,
        newText: 'This is the complete answer to your question.',
      });
      await processSegmentRegeneration(job);

      expect(mockPrismaSegmentCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ text: 'This is the complete answer to your question.' }),
      });
    });
  });

  describe('TTS generation', () => {
    it('calls getVoiceId with the correct speaker', async () => {
      const job = createMockJob({ ...defaultPayload, speaker: 'HOST' });
      await processSegmentRegeneration(job);

      expect(mockGetVoiceId).toHaveBeenCalledWith('HOST');
    });

    it('calls generateSpeech with the new text and voice ID', async () => {
      mockGetVoiceId.mockReturnValue('voice-host-123');
      const job = createMockJob({
        ...defaultPayload,
        newText: 'Let me clarify that point.',
        speaker: 'HOST',
      });
      await processSegmentRegeneration(job);

      expect(mockGenerateSpeech).toHaveBeenCalledWith({
        text: 'Let me clarify that point.',
        voiceId: 'voice-host-123',
      });
    });

    it('uses the voice ID returned by getVoiceId', async () => {
      mockGetVoiceId.mockReturnValue('custom-expert-voice');
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(mockGenerateSpeech).toHaveBeenCalledWith(
        expect.objectContaining({ voiceId: 'custom-expert-voice' })
      );
    });
  });

  describe('R2 upload', () => {
    it('uploads the generated audio buffer to R2', async () => {
      const audioBuffer = Buffer.from('generated-audio-bytes');
      mockGenerateSpeech.mockResolvedValue(audioBuffer);
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(mockUploadSegmentAudio).toHaveBeenCalledWith(
        'podcast-001',
        'segment-new-001',
        audioBuffer
      );
    });

    it('uses the segment ID returned by segment creation', async () => {
      mockPrismaSegmentCreate.mockResolvedValue({ id: 'segment-xyz-789' });
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(mockUploadSegmentAudio).toHaveBeenCalledWith(
        'podcast-001',
        'segment-xyz-789',
        expect.any(Buffer)
      );
    });

    it('updates the segment with the audio URL from R2', async () => {
      mockUploadSegmentAudio.mockResolvedValue('https://cdn.sotto.fm/segments/seg-001.mp3');
      mockPrismaSegmentCreate.mockResolvedValue({ id: 'segment-new-001' });
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(mockPrismaSegmentUpdate).toHaveBeenCalledWith({
        where: { id: 'segment-new-001' },
        data: { audioUrl: 'https://cdn.sotto.fm/segments/seg-001.mp3' },
      });
    });
  });

  describe('segment reordering', () => {
    it('queries all segments for the podcast ordered by order ascending', async () => {
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(mockPrismaSegmentFindMany).toHaveBeenCalledWith({
        where: { podcastId: 'podcast-001' },
        orderBy: { order: 'asc' },
      });
    });

    it('reorders all segments sequentially starting from 0', async () => {
      mockPrismaSegmentFindMany.mockResolvedValue([
        { id: 'segment-a', order: 0 },
        { id: 'segment-b', order: 1 },
        { id: 'segment-c', order: 3.5 },
        { id: 'segment-d', order: 4 },
      ]);
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(mockPrismaSegmentUpdate).toHaveBeenCalledWith({
        where: { id: 'segment-a' },
        data: { order: 0 },
      });
      expect(mockPrismaSegmentUpdate).toHaveBeenCalledWith({
        where: { id: 'segment-b' },
        data: { order: 1 },
      });
      expect(mockPrismaSegmentUpdate).toHaveBeenCalledWith({
        where: { id: 'segment-c' },
        data: { order: 2 },
      });
      expect(mockPrismaSegmentUpdate).toHaveBeenCalledWith({
        where: { id: 'segment-d' },
        data: { order: 3 },
      });
    });

    it('handles single segment reordering', async () => {
      mockPrismaSegmentFindMany.mockResolvedValue([{ id: 'segment-only', order: 0.5 }]);
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(mockPrismaSegmentUpdate).toHaveBeenCalledWith({
        where: { id: 'segment-only' },
        data: { order: 0 },
      });
    });

    it('reorders correctly when many segments exist', async () => {
      const segments = Array.from({ length: 10 }, (_, i) => ({
        id: `segment-${i}`,
        order: i * 2,
      }));
      mockPrismaSegmentFindMany.mockResolvedValue(segments);
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      for (let i = 0; i < 10; i++) {
        expect(mockPrismaSegmentUpdate).toHaveBeenCalledWith({
          where: { id: `segment-${i}` },
          data: { order: i },
        });
      }
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
    it('updates podcast status back to READY after regeneration', async () => {
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: { status: 'READY' },
      });
    });

    it('uses the podcast ID from the payload', async () => {
      const job = createMockJob({ ...defaultPayload, podcastId: 'podcast-xyz' });
      await processSegmentRegeneration(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-xyz' },
        data: { status: 'READY' },
      });
    });
  });

  describe('job progress updates', () => {
    it('reports progress at 10% after starting', async () => {
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(job.updateProgress).toHaveBeenCalledWith(10);
    });

    it('reports progress at 70% after audio upload', async () => {
      const job = createMockJob(defaultPayload);
      await processSegmentRegeneration(job);

      expect(job.updateProgress).toHaveBeenCalledWith(70);
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
      expect(progressCalls).toEqual([10, 70, 100]);
    });
  });

  describe('end-to-end flow', () => {
    it('executes the full regeneration pipeline for HOST segment', async () => {
      mockGetVoiceId.mockReturnValue('host-voice-id');
      mockGenerateSpeech.mockResolvedValue(Buffer.from('host-audio'));
      mockUploadSegmentAudio.mockResolvedValue('https://r2.example.com/host-audio.mp3');
      mockPrismaSegmentCreate.mockResolvedValue({ id: 'segment-new-host' });
      mockPrismaSegmentFindMany.mockResolvedValue([
        { id: 'segment-001', order: 0 },
        { id: 'segment-new-host', order: 1.5 },
        { id: 'segment-002', order: 2 },
      ]);

      const job = createMockJob({
        podcastId: 'podcast-001',
        interactionId: 'interaction-001',
        insertAfterOrder: 1,
        newText: 'Let me explain that further.',
        speaker: 'HOST',
      });
      await processSegmentRegeneration(job);

      // Segment created
      expect(mockPrismaSegmentCreate).toHaveBeenCalledWith({
        data: {
          podcastId: 'podcast-001',
          speaker: 'HOST',
          text: 'Let me explain that further.',
          order: 1.5,
        },
      });

      // Voice selected
      expect(mockGetVoiceId).toHaveBeenCalledWith('HOST');

      // Audio generated
      expect(mockGenerateSpeech).toHaveBeenCalledWith({
        text: 'Let me explain that further.',
        voiceId: 'host-voice-id',
      });

      // Uploaded to R2
      expect(mockUploadSegmentAudio).toHaveBeenCalledWith(
        'podcast-001',
        'segment-new-host',
        Buffer.from('host-audio')
      );

      // Segment updated with audio URL
      expect(mockPrismaSegmentUpdate).toHaveBeenCalledWith({
        where: { id: 'segment-new-host' },
        data: { audioUrl: 'https://r2.example.com/host-audio.mp3' },
      });

      // All segments reordered
      expect(mockPrismaSegmentUpdate).toHaveBeenCalledWith({
        where: { id: 'segment-001' },
        data: { order: 0 },
      });
      expect(mockPrismaSegmentUpdate).toHaveBeenCalledWith({
        where: { id: 'segment-new-host' },
        data: { order: 1 },
      });
      expect(mockPrismaSegmentUpdate).toHaveBeenCalledWith({
        where: { id: 'segment-002' },
        data: { order: 2 },
      });

      // Interaction marked as incorporated
      expect(mockPrismaInteractionUpdate).toHaveBeenCalledWith({
        where: { id: 'interaction-001' },
        data: { status: 'INCORPORATED', incorporated: true },
      });

      // Podcast status updated to READY
      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: { status: 'READY' },
      });
    });

    it('executes the full regeneration pipeline for EXPERT segment', async () => {
      mockGetVoiceId.mockReturnValue('expert-voice-id');
      mockGenerateSpeech.mockResolvedValue(Buffer.from('expert-audio'));
      mockUploadSegmentAudio.mockResolvedValue('https://r2.example.com/expert-audio.mp3');
      mockPrismaSegmentCreate.mockResolvedValue({ id: 'segment-new-expert' });

      const job = createMockJob({
        podcastId: 'podcast-002',
        interactionId: 'interaction-002',
        insertAfterOrder: 5,
        newText: 'That is a great observation.',
        speaker: 'EXPERT',
      });
      await processSegmentRegeneration(job);

      // Voice selected for EXPERT
      expect(mockGetVoiceId).toHaveBeenCalledWith('EXPERT');

      // Audio generated
      expect(mockGenerateSpeech).toHaveBeenCalledWith({
        text: 'That is a great observation.',
        voiceId: 'expert-voice-id',
      });

      // Interaction marked incorporated
      expect(mockPrismaInteractionUpdate).toHaveBeenCalledWith({
        where: { id: 'interaction-002' },
        data: { status: 'INCORPORATED', incorporated: true },
      });

      // Podcast ready
      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-002' },
        data: { status: 'READY' },
      });
    });
  });

  describe('error propagation', () => {
    it('propagates errors from segment creation', async () => {
      mockPrismaSegmentCreate.mockRejectedValue(new Error('Database connection failed'));
      const job = createMockJob(defaultPayload);

      await expect(processSegmentRegeneration(job)).rejects.toThrow('Database connection failed');
    });

    it('propagates errors from generateSpeech', async () => {
      mockGenerateSpeech.mockRejectedValue(new Error('ElevenLabs API error (429): rate limited'));
      const job = createMockJob(defaultPayload);

      await expect(processSegmentRegeneration(job)).rejects.toThrow(
        'ElevenLabs API error (429): rate limited'
      );
    });

    it('propagates errors from uploadSegmentAudio', async () => {
      mockUploadSegmentAudio.mockRejectedValue(new Error('R2 storage not configured'));
      const job = createMockJob(defaultPayload);

      await expect(processSegmentRegeneration(job)).rejects.toThrow('R2 storage not configured');
    });

    it('propagates errors from segment update', async () => {
      mockPrismaSegmentUpdate.mockRejectedValue(new Error('Record not found'));
      const job = createMockJob(defaultPayload);

      await expect(processSegmentRegeneration(job)).rejects.toThrow('Record not found');
    });

    it('propagates errors from interaction update', async () => {
      mockPrismaSegmentUpdate.mockResolvedValueOnce({});
      mockPrismaInteractionUpdate.mockRejectedValue(new Error('Interaction does not exist'));
      const job = createMockJob(defaultPayload);

      await expect(processSegmentRegeneration(job)).rejects.toThrow('Interaction does not exist');
    });

    it('propagates errors from podcast update', async () => {
      mockPrismaSegmentUpdate.mockResolvedValue({});
      mockPrismaInteractionUpdate.mockResolvedValueOnce({});
      mockPrismaPodcastUpdate.mockRejectedValue(new Error('Podcast not found'));
      const job = createMockJob(defaultPayload);

      await expect(processSegmentRegeneration(job)).rejects.toThrow('Podcast not found');
    });
  });
});
