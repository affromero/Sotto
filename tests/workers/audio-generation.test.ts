import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks (must be declared before any import that touches the modules) ----

const mockPrismaSegmentUpdate = vi.fn().mockResolvedValue({});
const mockPrismaSegmentCount = vi.fn().mockResolvedValue(0);
const mockPrismaSegmentFindMany = vi.fn().mockResolvedValue([]);
const mockPrismaPodcastUpdate = vi.fn().mockResolvedValue({});

vi.mock('@/lib/prisma', () => ({
  prisma: {
    segment: {
      update: (...args: unknown[]) => mockPrismaSegmentUpdate(...args),
      count: (...args: unknown[]) => mockPrismaSegmentCount(...args),
      findMany: (...args: unknown[]) => mockPrismaSegmentFindMany(...args),
    },
    podcast: {
      update: (...args: unknown[]) => mockPrismaPodcastUpdate(...args),
    },
  },
}));

const mockGenerateSpeech = vi.fn().mockResolvedValue(Buffer.from('fake-audio'));
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
  generateSpeech: (...args: unknown[]) => mockGenerateSpeech(...args),
  getVoiceId: (...args: unknown[]) => mockGetVoiceId(...args),
  getVoiceProfile: (...args: unknown[]) => mockGetVoiceProfile(...args),
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

// ---- Tests ----

describe('processAudioGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no pending segments (all done)
    mockPrismaSegmentCount.mockResolvedValue(0);
    mockPrismaSegmentFindMany.mockResolvedValue([
      { id: 'segment-001' },
      { id: 'segment-002' },
    ]);
    mockGenerateSpeech.mockResolvedValue(Buffer.from('fake-audio-data'));
    mockUploadSegmentAudio.mockResolvedValue('https://r2.example.com/podcasts/podcast-001/segments/segment-001.mp3');
    mockGetVoiceId.mockReturnValue('voice-abc');
    mockGetVoiceProfile.mockReturnValue({
      id: 'voice-abc',
      name: 'Adam',
      gender: 'male',
      accent: 'american',
      ageRange: 'middle',
      character: 'warm narrator',
    });
  });

  describe('voice selection', () => {
    it('calls getVoiceId with speaker and podcastId for voice diversity', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockGetVoiceId).toHaveBeenCalledWith('HOST', 'podcast-001');
    });

    it('passes HOST speaker to getVoiceId when speaker is HOST', async () => {
      const job = createMockJob({ ...defaultPayload, speaker: 'HOST' });
      await processAudioGeneration(job);

      expect(mockGetVoiceId).toHaveBeenCalledWith('HOST', 'podcast-001');
    });

    it('passes EXPERT speaker to getVoiceId when speaker is EXPERT', async () => {
      const job = createMockJob({ ...defaultPayload, speaker: 'EXPERT' });
      await processAudioGeneration(job);

      expect(mockGetVoiceId).toHaveBeenCalledWith('EXPERT', 'podcast-001');
    });

    it('calls getVoiceProfile with the returned voiceId', async () => {
      mockGetVoiceId.mockReturnValue('voice-xyz');
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockGetVoiceProfile).toHaveBeenCalledWith('voice-xyz');
    });
  });

  describe('speech generation', () => {
    it('calls generateSpeech with correct text and voiceId', async () => {
      mockGetVoiceId.mockReturnValue('voice-host-123');
      const job = createMockJob({
        ...defaultPayload,
        text: 'This is a test segment.',
      });
      await processAudioGeneration(job);

      expect(mockGenerateSpeech).toHaveBeenCalledWith({
        text: 'This is a test segment.',
        voiceId: 'voice-host-123',
      });
    });

    it('calls generateSpeech with the voiceId from getVoiceId, not a hardcoded one', async () => {
      mockGetVoiceId.mockReturnValue('completely-different-voice');
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockGenerateSpeech).toHaveBeenCalledWith(
        expect.objectContaining({ voiceId: 'completely-different-voice' })
      );
    });
  });

  describe('R2 upload', () => {
    it('uploads the generated audio buffer to R2', async () => {
      const audioBuffer = Buffer.from('generated-audio-bytes');
      mockGenerateSpeech.mockResolvedValue(audioBuffer);
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
      mockGenerateSpeech.mockResolvedValue(specificBuffer);
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      const uploadedBuffer = mockUploadSegmentAudio.mock.calls[0][2];
      expect(uploadedBuffer).toBe(specificBuffer);
    });
  });

  describe('database updates', () => {
    it('updates the segment with the audio URL from R2', async () => {
      mockUploadSegmentAudio.mockResolvedValue('https://cdn.sotto.fm/segments/seg-001.mp3');
      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      expect(mockPrismaSegmentUpdate).toHaveBeenCalledWith({
        where: { id: 'segment-001' },
        data: { audioUrl: 'https://cdn.sotto.fm/segments/seg-001.mp3' },
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

      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'audio-stitching' },
        'stitch_audio',
        {
          podcastId: 'podcast-001',
          segmentIds: ['seg-a', 'seg-b', 'seg-c'],
        }
      );
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
    it('executes the full pipeline for a HOST segment', async () => {
      mockGetVoiceId.mockReturnValue('host-voice-id');
      mockGenerateSpeech.mockResolvedValue(Buffer.from('host-audio'));
      mockUploadSegmentAudio.mockResolvedValue('https://r2.example.com/host-audio.mp3');
      mockPrismaSegmentCount.mockResolvedValue(0);
      mockPrismaSegmentFindMany.mockResolvedValue([{ id: 'segment-001' }]);

      const job = createMockJob(defaultPayload);
      await processAudioGeneration(job);

      // Voice selected
      expect(mockGetVoiceId).toHaveBeenCalledWith('HOST', 'podcast-001');

      // Audio generated
      expect(mockGenerateSpeech).toHaveBeenCalledWith({
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
        data: { audioUrl: 'https://r2.example.com/host-audio.mp3' },
      });

      // Stitching queued (last segment)
      expect(mockAddJob).toHaveBeenCalled();
      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: { status: 'STITCHING' },
      });
    });

    it('executes the full pipeline for an EXPERT segment that is not the last', async () => {
      mockGetVoiceId.mockReturnValue('expert-voice-id');
      mockGenerateSpeech.mockResolvedValue(Buffer.from('expert-audio'));
      mockUploadSegmentAudio.mockResolvedValue('https://r2.example.com/expert-audio.mp3');
      mockPrismaSegmentCount.mockResolvedValue(5);

      const job = createMockJob({
        podcastId: 'podcast-002',
        segmentId: 'segment-042',
        speaker: 'EXPERT',
        text: 'That is a great question, let me explain.',
      });
      await processAudioGeneration(job);

      // Voice selected for EXPERT
      expect(mockGetVoiceId).toHaveBeenCalledWith('EXPERT', 'podcast-002');

      // Audio generated
      expect(mockGenerateSpeech).toHaveBeenCalledWith({
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
        data: { audioUrl: 'https://r2.example.com/expert-audio.mp3' },
      });

      // No stitching (still pending)
      expect(mockAddJob).not.toHaveBeenCalled();
      expect(mockPrismaPodcastUpdate).not.toHaveBeenCalled();
    });
  });

  describe('error propagation', () => {
    it('propagates errors from generateSpeech', async () => {
      mockGenerateSpeech.mockRejectedValue(new Error('ElevenLabs API error (429): rate limited'));
      const job = createMockJob(defaultPayload);

      await expect(processAudioGeneration(job)).rejects.toThrow('ElevenLabs API error (429): rate limited');
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
