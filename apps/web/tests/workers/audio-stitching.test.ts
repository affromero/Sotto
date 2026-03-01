import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks (must be declared before any import that touches the modules) ----

const mockPrismaSegmentFindMany = vi.fn().mockResolvedValue([]);
const mockPrismaSegmentUpdate = vi.fn().mockResolvedValue({});
const mockPrismaScriptFindUnique = vi.fn().mockResolvedValue({ soundCues: [] });
const mockPrismaPodcastFindUniqueOrThrow = vi.fn().mockResolvedValue({
  userId: 'user-1',
  title: 'Test Podcast',
  source: 'WEB',
  sourceTweetId: null,
  currentVersion: 0,
  audioUrl: null,
  user: { telegramEnabled: false, telegramChatId: null },
});
const mockPrismaPodcastFindUnique = vi.fn().mockResolvedValue(null);
const mockPrismaPodcastUpdate = vi.fn().mockResolvedValue({});
const mockPrismaPodcastVersionCreate = vi.fn().mockResolvedValue({});
const mockPrismaTweetMentionFindFirst = vi.fn().mockResolvedValue(null);
const mockPrismaTweetMentionUpdate = vi.fn().mockResolvedValue({});
const mockPrismaTelegramMessageFindFirst = vi.fn().mockResolvedValue(null);
const mockPrismaTelegramMessageUpdate = vi.fn().mockResolvedValue({});
const mockPrismaTwitterAutoTweetFindFirst = vi.fn().mockResolvedValue(null);
const mockPrismaDiscoveryFindUnique = vi.fn().mockResolvedValue({ durationTarget: 5 });
const mockPrismaPipelineEventCreate = vi.fn().mockResolvedValue({});
const mockPrismaUserFindUniqueOrThrow = vi.fn().mockResolvedValue({ role: 'USER', plan: 'FREE' });

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    segment: {
      findMany: (...args: unknown[]) => mockPrismaSegmentFindMany(...args),
      update: (...args: unknown[]) => mockPrismaSegmentUpdate(...args),
    },
    script: {
      findUnique: (...args: unknown[]) => mockPrismaScriptFindUnique(...args),
    },
    podcast: {
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaPodcastFindUniqueOrThrow(...args),
      findUnique: (...args: unknown[]) => mockPrismaPodcastFindUnique(...args),
      update: (...args: unknown[]) => mockPrismaPodcastUpdate(...args),
    },
    podcastVersion: {
      create: (...args: unknown[]) => mockPrismaPodcastVersionCreate(...args),
    },
    discovery: {
      findUnique: (...args: unknown[]) => mockPrismaDiscoveryFindUnique(...args),
    },
    user: {
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaUserFindUniqueOrThrow(...args),
    },
    tweetMention: {
      findFirst: (...args: unknown[]) => mockPrismaTweetMentionFindFirst(...args),
      update: (...args: unknown[]) => mockPrismaTweetMentionUpdate(...args),
    },
    telegramMessage: {
      findFirst: (...args: unknown[]) => mockPrismaTelegramMessageFindFirst(...args),
      update: (...args: unknown[]) => mockPrismaTelegramMessageUpdate(...args),
    },
    twitterAutoTweet: {
      findFirst: (...args: unknown[]) => mockPrismaTwitterAutoTweetFindFirst(...args),
    },
    pipelineEvent: {
      create: (...args: unknown[]) => mockPrismaPipelineEventCreate(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

const mockStitchWithEffects = vi.fn().mockResolvedValue({ duration: 300 });
const mockGetAudioDuration = vi.fn().mockResolvedValue(300);

vi.mock('@/lib/audio-stitcher', () => ({
  stitchWithEffects: (...args: unknown[]) => mockStitchWithEffects(...args),
  getAudioDuration: (...args: unknown[]) => mockGetAudioDuration(...args),
}));

const mockDownloadFile = vi.fn().mockResolvedValue(Buffer.from('segment-audio'));
const mockUploadPodcastAudio = vi.fn().mockResolvedValue('https://r2.example.com/final.mp3');

vi.mock('@/lib/r2', () => ({
  downloadFile: (...args: unknown[]) => mockDownloadFile(...args),
  uploadPodcastAudio: (...args: unknown[]) => mockUploadPodcastAudio(...args),
  deleteFile: vi.fn().mockResolvedValue(undefined),
}));

const mockAddJob = vi.fn().mockResolvedValue({ id: 'notification-job-1' });

vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: {
    SEND_NOTIFICATION: 'send_notification',
    GENERATE_PDF: 'generate_pdf',
    REPLY_TWITTER: 'reply_twitter',
    REPLY_TELEGRAM: 'reply_telegram',
    AUTO_TWEET: 'AUTO_TWEET',
  },
  notificationQueue: { name: 'notifications' },
  pdfGenerationQueue: { name: 'pdf-generation' },
  twitterReplyQueue: { name: 'twitter-reply' },
  telegramReplyQueue: { name: 'telegram-reply' },
  twitterAutoTweetQueue: { name: 'twitter-auto-tweet' },
}));

const mockGenerateSoundEffect = vi.fn().mockResolvedValue(Buffer.from('sfx-audio'));

vi.mock('@/lib/elevenlabs', () => ({
  generateSoundEffect: (...args: unknown[]) => mockGenerateSoundEffect(...args),
}));

vi.mock('@/lib/byok', () => ({
  hasByokKey: vi.fn().mockResolvedValue(false),
}));

const mockConsumeFreeGeneration = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/generation-gate', () => ({
  consumeFreeGeneration: (...args: unknown[]) => mockConsumeFreeGeneration(...args),
}));

vi.mock('@/lib/stripe', () => ({
  LIMITS: {
    maxDurationMinutes: 30,
    maxVoiceClones: 10,
    canMakePrivate: true,
    canExportPdf: true,
    hasPremiumSfx: true,
  },
}));

const mockMarkPodcastFailed = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/pipeline-resume', () => ({
  markPodcastFailed: (...args: unknown[]) => mockMarkPodcastFailed(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock fs/promises operations
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockRm = vi.fn().mockResolvedValue(undefined);
const mockReadFile = vi.fn().mockResolvedValue(Buffer.from('final-audio-data'));
const mockCopyFile = vi.fn().mockResolvedValue(undefined);

vi.mock('fs/promises', () => ({
  default: {
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    mkdir: (...args: unknown[]) => mockMkdir(...args),
    rm: (...args: unknown[]) => mockRm(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
    copyFile: (...args: unknown[]) => mockCopyFile(...args),
  },
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  rm: (...args: unknown[]) => mockRm(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  copyFile: (...args: unknown[]) => mockCopyFile(...args),
}));

// ---- Import under test ----
import { processAudioStitching } from '@/workers/audio-stitching.worker';
import type { StitchAudioPayload } from '@/lib/queue';
import type { Job } from 'bullmq';

// ---- Helpers ----

function createMockJob(data: StitchAudioPayload): Job<StitchAudioPayload> {
  return {
    data,
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<StitchAudioPayload>;
}

const defaultPayload: StitchAudioPayload = {
  podcastId: 'podcast-001',
  segmentIds: ['seg-1', 'seg-2', 'seg-3'],
};

// ---- Tests ----

describe('processAudioStitching', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default segment data - first call (initial fetch with audioUrl)
    mockPrismaSegmentFindMany.mockResolvedValueOnce([
      { id: 'seg-1', audioUrl: 'https://r2.example.com/seg-1.mp3', order: 0, duration: 100 },
      { id: 'seg-2', audioUrl: 'https://r2.example.com/seg-2.mp3', order: 1, duration: 100 },
      { id: 'seg-3', audioUrl: 'https://r2.example.com/seg-3.mp3', order: 2, duration: 100 },
    ]);
    // Default segment data - second call (fresh duration data for startTime)
    mockPrismaSegmentFindMany.mockResolvedValueOnce([
      { id: 'seg-1', duration: 100 },
      { id: 'seg-2', duration: 100 },
      { id: 'seg-3', duration: 100 },
    ]);

    // Default podcast data
    mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
      userId: 'user-1',
      title: 'Test Podcast',
      source: 'WEB',
      sourceTweetId: null,
      currentVersion: 0,
      audioUrl: null,
      user: { telegramEnabled: false, telegramChatId: null },
    });

    // Default script data (no sound cues)
    mockPrismaScriptFindUnique.mockResolvedValue({ soundCues: [] });

    // Default stitch result
    mockStitchWithEffects.mockResolvedValue({ duration: 300 });

    // Default file operations
    mockDownloadFile.mockResolvedValue(Buffer.from('segment-audio'));
    mockReadFile.mockResolvedValue(Buffer.from('final-audio-data'));
    mockUploadPodcastAudio.mockResolvedValue('https://r2.example.com/final.mp3');
  });

  describe('segment fetching', () => {
    it('throws error when no segments are found', async () => {
      mockPrismaSegmentFindMany.mockReset().mockResolvedValueOnce([]);
      const job = createMockJob(defaultPayload);

      await expect(processAudioStitching(job)).rejects.toThrow(
        'No segments found for podcast podcast-001'
      );
    });

    it('throws error when segment is missing audioUrl', async () => {
      mockPrismaSegmentFindMany.mockReset().mockResolvedValueOnce([
        { id: 'seg-1', audioUrl: 'https://r2.example.com/seg-1.mp3', order: 0, duration: 100 },
        { id: 'seg-2', audioUrl: null, order: 1, duration: 100 },
      ]);
      const job = createMockJob(defaultPayload);

      await expect(processAudioStitching(job)).rejects.toThrow(
        'Segment seg-2 (order 1) has no audioUrl'
      );
    });
  });

  describe('audio downloading', () => {
    it('downloads all segment audio files from R2', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioStitching(job);

      expect(mockDownloadFile).toHaveBeenCalledTimes(3);
      expect(mockDownloadFile).toHaveBeenCalledWith('https://r2.example.com/seg-1.mp3');
      expect(mockDownloadFile).toHaveBeenCalledWith('https://r2.example.com/seg-2.mp3');
      expect(mockDownloadFile).toHaveBeenCalledWith('https://r2.example.com/seg-3.mp3');
    });
  });

  describe('FFmpeg stitching', () => {
    it('calls stitchWithEffects with segment paths', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioStitching(job);

      expect(mockStitchWithEffects).toHaveBeenCalledWith(
        expect.objectContaining({
          segmentPaths: expect.arrayContaining([
            expect.stringMatching(/seg-000\.mp3$/),
            expect.stringMatching(/seg-001\.mp3$/),
            expect.stringMatching(/seg-002\.mp3$/),
          ]),
          outputPath: expect.stringMatching(/final\.mp3$/),
          crossfadeMs: 300,
        })
      );
    });

    it('passes correct number of segment paths to stitchWithEffects', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioStitching(job);

      const callArgs = mockStitchWithEffects.mock.calls[0][0];
      expect(callArgs.segmentPaths).toHaveLength(3);
    });

    it('includes empty sfxInserts array when no sound cues', async () => {
      mockPrismaScriptFindUnique.mockResolvedValue({ soundCues: [] });
      const job = createMockJob(defaultPayload);
      await processAudioStitching(job);

      const callArgs = mockStitchWithEffects.mock.calls[0][0];
      expect(callArgs.sfxInserts).toEqual([]);
    });
  });

  describe('sound effects', () => {
    beforeEach(() => {
      mockPrismaScriptFindUnique.mockResolvedValue({
        soundCues: [
          { type: 'intro', prompt: 'Warm intro', durationSeconds: 2, insertAfterTurn: 0 },
          {
            type: 'transition',
            prompt: 'Smooth transition',
            durationSeconds: 1,
            insertAfterTurn: 2,
          },
        ],
      });
    });

    it('generates premium SFX via ElevenLabs', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioStitching(job);

      expect(mockGenerateSoundEffect).toHaveBeenCalledTimes(2);
      expect(mockCopyFile).not.toHaveBeenCalled();
    });

    it('passes SFX inserts to stitchWithEffects', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioStitching(job);

      const callArgs = mockStitchWithEffects.mock.calls[0][0];
      expect(callArgs.sfxInserts).toHaveLength(2);
      expect(callArgs.sfxInserts[0]).toMatchObject({
        insertAfterSegment: 0,
        durationMs: 2000,
        delayMs: 100000, // 100s * 1000ms
        type: 'intro',
      });
      expect(callArgs.sfxInserts[1]).toMatchObject({
        insertAfterSegment: 2,
        durationMs: 1000,
        delayMs: 300000, // (100s + 100s + 100s) * 1000ms
        type: 'transition',
      });
    });

    it('SFX inserts include computed delayMs based on cumulative segment durations', async () => {
      // Reset and mock initial fetch
      mockPrismaSegmentFindMany.mockReset().mockResolvedValueOnce([
        { id: 'seg-1', audioUrl: 'https://r2.example.com/seg-1.mp3', order: 0, duration: 50 },
        { id: 'seg-2', audioUrl: 'https://r2.example.com/seg-2.mp3', order: 1, duration: 75 },
        { id: 'seg-3', audioUrl: 'https://r2.example.com/seg-3.mp3', order: 2, duration: 100 },
      ]);
      // Mock fresh fetch for startTime calculation
      mockPrismaSegmentFindMany.mockResolvedValueOnce([
        { id: 'seg-1', duration: 50 },
        { id: 'seg-2', duration: 75 },
        { id: 'seg-3', duration: 100 },
      ]);
      mockPrismaScriptFindUnique.mockResolvedValue({
        soundCues: [
          { type: 'intro', prompt: 'Warm intro', durationSeconds: 2, insertAfterTurn: 0 },
          { type: 'transition', prompt: 'Transition', durationSeconds: 1, insertAfterTurn: 1 },
        ],
      });

      const job = createMockJob(defaultPayload);
      await processAudioStitching(job);

      const callArgs = mockStitchWithEffects.mock.calls[0][0];
      expect(callArgs.sfxInserts).toHaveLength(2);
      expect(callArgs.sfxInserts[0].delayMs).toBe(50000); // 50s * 1000ms
      expect(callArgs.sfxInserts[1].delayMs).toBe(125000); // (50s + 75s) * 1000ms
    });
  });

  describe('skipSfx option', () => {
    beforeEach(() => {
      mockPrismaScriptFindUnique.mockResolvedValue({
        soundCues: [
          { type: 'intro', prompt: 'Warm intro', durationSeconds: 2, insertAfterTurn: 0 },
        ],
      });
    });

    it('skips SFX generation when skipSfx is true', async () => {
      const job = createMockJob({ ...defaultPayload, skipSfx: true });
      await processAudioStitching(job);

      expect(mockGenerateSoundEffect).not.toHaveBeenCalled();
      expect(mockCopyFile).not.toHaveBeenCalled();
    });

    it('passes empty sfxInserts array to stitchWithEffects when skipSfx is true', async () => {
      const job = createMockJob({ ...defaultPayload, skipSfx: true });
      await processAudioStitching(job);

      const callArgs = mockStitchWithEffects.mock.calls[0][0];
      expect(callArgs.sfxInserts).toEqual([]);
    });

    it('still stitches audio successfully when skipSfx is true', async () => {
      const job = createMockJob({ ...defaultPayload, skipSfx: true });
      await processAudioStitching(job);

      expect(mockStitchWithEffects).toHaveBeenCalled();
      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: expect.objectContaining({ status: 'READY' }),
      });
    });
  });

  describe('premium sound effects', () => {
    beforeEach(() => {
      mockPrismaScriptFindUnique.mockResolvedValue({
        soundCues: [
          {
            type: 'intro',
            prompt: 'Warm intro with soft piano',
            durationSeconds: 3,
            insertAfterTurn: 0,
          },
        ],
      });
    });

    it('generates premium SFX via ElevenLabs with custom prompt', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioStitching(job);

      expect(mockGenerateSoundEffect).toHaveBeenCalledWith({
        prompt: 'Warm intro with soft piano',
        durationSeconds: 3,
      });
      expect(mockCopyFile).not.toHaveBeenCalled();
    });

    it('falls back to stock SFX when ElevenLabs fails', async () => {
      mockGenerateSoundEffect.mockRejectedValue(new Error('ElevenLabs API error'));
      const job = createMockJob(defaultPayload);
      await processAudioStitching(job);

      expect(mockCopyFile).toHaveBeenCalledTimes(1);
      expect(mockGenerateSoundEffect).toHaveBeenCalled();
    });
  });

  describe('R2 upload', () => {
    it('uploads final audio to R2', async () => {
      mockReadFile.mockResolvedValue(Buffer.from('final-audio-bytes'));
      const job = createMockJob(defaultPayload);
      await processAudioStitching(job);

      expect(mockUploadPodcastAudio).toHaveBeenCalledWith(
        'podcast-001',
        Buffer.from('final-audio-bytes')
      );
    });
  });

  describe('podcast status update', () => {
    it('updates podcast status to READY', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioStitching(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: expect.objectContaining({
          status: 'READY',
        }),
      });
    });

    it('updates podcast with audioUrl from R2', async () => {
      mockUploadPodcastAudio.mockResolvedValue('https://cdn.sotto.fm/final.mp3');
      const job = createMockJob(defaultPayload);
      await processAudioStitching(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: expect.objectContaining({
          audioUrl: 'https://cdn.sotto.fm/final.mp3',
        }),
      });
    });

    it('updates podcast with duration from stitcher', async () => {
      mockStitchWithEffects.mockResolvedValue({ duration: 250.75 });
      const job = createMockJob(defaultPayload);
      await processAudioStitching(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: expect.objectContaining({
          duration: 251, // rounded
        }),
      });
    });

    it('updates podcast with file size', async () => {
      mockReadFile.mockResolvedValue(Buffer.alloc(1024 * 512)); // 512 KB
      const job = createMockJob(defaultPayload);
      await processAudioStitching(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: expect.objectContaining({
          fileSize: 1024 * 512,
        }),
      });
    });
  });

  describe('segment start times', () => {
    it('updates each segment with cumulative start time', async () => {
      // Reset and mock initial fetch
      mockPrismaSegmentFindMany.mockReset().mockResolvedValueOnce([
        { id: 'seg-1', audioUrl: 'https://r2.example.com/seg-1.mp3', order: 0, duration: 100 },
        { id: 'seg-2', audioUrl: 'https://r2.example.com/seg-2.mp3', order: 1, duration: 150 },
        { id: 'seg-3', audioUrl: 'https://r2.example.com/seg-3.mp3', order: 2, duration: 200 },
      ]);
      // Mock fresh fetch for startTime calculation
      mockPrismaSegmentFindMany.mockResolvedValueOnce([
        { id: 'seg-1', duration: 100 },
        { id: 'seg-2', duration: 150 },
        { id: 'seg-3', duration: 200 },
      ]);

      const job = createMockJob(defaultPayload);
      await processAudioStitching(job);

      expect(mockPrismaSegmentUpdate).toHaveBeenCalledWith({
        where: { id: 'seg-1' },
        data: { startTime: 0 },
      });
      expect(mockPrismaSegmentUpdate).toHaveBeenCalledWith({
        where: { id: 'seg-2' },
        data: { startTime: 100 },
      });
      expect(mockPrismaSegmentUpdate).toHaveBeenCalledWith({
        where: { id: 'seg-3' },
        data: { startTime: 250 },
      });
    });

    it('handles segments with null duration', async () => {
      // Reset and mock initial fetch
      mockPrismaSegmentFindMany.mockReset().mockResolvedValueOnce([
        { id: 'seg-1', audioUrl: 'https://r2.example.com/seg-1.mp3', order: 0, duration: 100 },
        { id: 'seg-2', audioUrl: 'https://r2.example.com/seg-2.mp3', order: 1, duration: null },
        { id: 'seg-3', audioUrl: 'https://r2.example.com/seg-3.mp3', order: 2, duration: 200 },
      ]);
      // Mock fresh fetch for startTime calculation
      mockPrismaSegmentFindMany.mockResolvedValueOnce([
        { id: 'seg-1', duration: 100 },
        { id: 'seg-2', duration: null },
        { id: 'seg-3', duration: 200 },
      ]);

      const job = createMockJob(defaultPayload);
      await processAudioStitching(job);

      expect(mockPrismaSegmentUpdate).toHaveBeenCalledWith({
        where: { id: 'seg-3' },
        data: { startTime: 100 }, // 100 + 0 (null treated as 0)
      });
    });
  });

  describe('notification', () => {
    it('queues notification job after stitching complete', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioStitching(job);

      expect(mockAddJob).toHaveBeenCalledWith({ name: 'notifications' }, 'send_notification', {
        userId: 'user-1',
        type: 'PODCAST_READY',
        title: 'Your podcast is ready!',
        message: '"Test Podcast" is ready to play.',
        data: { podcastId: 'podcast-001' },
      });
    });

    it('includes podcast title in notification message', async () => {
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-2',
        title: 'Quantum Computing Explained',
        source: 'WEB',
        sourceTweetId: null,
        currentVersion: 0,
        audioUrl: null,
        user: { telegramEnabled: false, telegramChatId: null },
      });
      const job = createMockJob(defaultPayload);
      await processAudioStitching(job);

      expect(mockAddJob).toHaveBeenCalledWith(
        expect.anything(),
        'send_notification',
        expect.objectContaining({
          message: '"Quantum Computing Explained" is ready to play.',
        })
      );
    });
  });

  describe('Twitter reply (source=TWITTER)', () => {
    beforeEach(() => {
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-1',
        title: 'Test Podcast',
        source: 'TWITTER',
        sourceTweetId: 'tweet-123',
        currentVersion: 0,
        audioUrl: null,
        user: { telegramEnabled: false, telegramChatId: null },
      });
      mockPrismaTweetMentionFindFirst.mockResolvedValue({
        id: 'mention-1',
        tweetId: 'tweet-123',
        status: 'GENERATING',
      });
    });

    it('queues Twitter reply when source is TWITTER', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioStitching(job);

      expect(mockAddJob).toHaveBeenCalledWith({ name: 'twitter-reply' }, 'reply_twitter', {
        podcastId: 'podcast-001',
        tweetMentionId: 'mention-1',
        originalTweetId: 'tweet-123',
      });
    });

    it('updates mention status to READY after queueing reply', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioStitching(job);

      expect(mockPrismaTweetMentionUpdate).toHaveBeenCalledWith({
        where: { id: 'mention-1' },
        data: { status: 'READY' },
      });
    });

    it('does not queue Twitter reply when source is WEB', async () => {
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-1',
        title: 'Test Podcast',
        source: 'WEB',
        sourceTweetId: null,
        currentVersion: 0,
        audioUrl: null,
        user: { telegramEnabled: false, telegramChatId: null },
      });
      const job = createMockJob(defaultPayload);
      await processAudioStitching(job);

      expect(mockPrismaTweetMentionFindFirst).not.toHaveBeenCalled();
      expect(mockAddJob).toHaveBeenCalledTimes(2); // notification + transcript
    });

    it('does not queue Twitter reply when mention is not found', async () => {
      mockPrismaTweetMentionFindFirst.mockResolvedValue(null);
      const job = createMockJob(defaultPayload);
      await processAudioStitching(job);

      const replyJobCall = mockAddJob.mock.calls.find((call) => call[1] === 'reply_twitter');
      expect(replyJobCall).toBeUndefined();
    });
  });

  describe('progress tracking', () => {
    it('reports monotonically increasing progress ending at 100', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioStitching(job);

      const calls = (job.updateProgress as ReturnType<typeof vi.fn>).mock.calls.map((c: any[]) => c[0]);
      for (let i = 1; i < calls.length; i++) {
        expect(calls[i]).toBeGreaterThanOrEqual(calls[i - 1]);
      }
      expect(calls[calls.length - 1]).toBe(100);
    });
  });

  describe('temp cleanup', () => {
    it('cleans up temp directory after successful completion', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioStitching(job);

      expect(mockRm).toHaveBeenCalled();
    });

    it('cleans up temp directory even when job fails', async () => {
      mockPrismaSegmentFindMany.mockReset().mockResolvedValueOnce([
        { id: 'seg-1', audioUrl: 'https://r2.example.com/seg-1.mp3', order: 0, duration: 100 },
        { id: 'seg-2', audioUrl: 'https://r2.example.com/seg-2.mp3', order: 1, duration: 100 },
        { id: 'seg-3', audioUrl: 'https://r2.example.com/seg-3.mp3', order: 2, duration: 100 },
      ]);
      mockStitchWithEffects.mockRejectedValue(new Error('FFmpeg error'));
      const job = createMockJob(defaultPayload);

      await expect(processAudioStitching(job)).rejects.toThrow('FFmpeg error');

      expect(mockRm).toHaveBeenCalled();
    });
  });

  describe('duration limit failure', () => {
    it('sends PODCAST_FAILED notification when duration exceeds limit', async () => {
      // LIMITS.maxDurationMinutes is 30, so max with 10% grace = 1980s
      mockStitchWithEffects.mockResolvedValue({ duration: 2100 });
      const job = createMockJob(defaultPayload);
      await processAudioStitching(job);

      expect(mockMarkPodcastFailed).toHaveBeenCalledWith('podcast-001', expect.objectContaining({
        technicalError: expect.stringContaining('exceeded max'),
      }));
      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'notifications' },
        'send_notification',
        expect.objectContaining({ type: 'PODCAST_FAILED', title: 'Podcast generation failed' })
      );
    });
  });

  describe('error handling', () => {
    it('marks podcast as FAILED when stitching fails', async () => {
      mockStitchWithEffects.mockReset().mockRejectedValue(new Error('FFmpeg error'));
      // Need to provide segment data since stitching happens after segment fetch
      mockPrismaSegmentFindMany.mockReset().mockResolvedValueOnce([
        { id: 'seg-1', audioUrl: 'https://r2.example.com/seg-1.mp3', order: 0, duration: 100 },
        { id: 'seg-2', audioUrl: 'https://r2.example.com/seg-2.mp3', order: 1, duration: 100 },
        { id: 'seg-3', audioUrl: 'https://r2.example.com/seg-3.mp3', order: 2, duration: 100 },
      ]);
      const job = createMockJob(defaultPayload);

      await expect(processAudioStitching(job)).rejects.toThrow('FFmpeg error');

      expect(mockMarkPodcastFailed).toHaveBeenCalledWith('podcast-001', {
        technicalError: 'FFmpeg error',
      });
    });

    it('propagates error from downloadFile', async () => {
      mockDownloadFile.mockRejectedValue(new Error('R2 download failed'));
      const job = createMockJob(defaultPayload);

      await expect(processAudioStitching(job)).rejects.toThrow('R2 download failed');
    });

    it('propagates error from uploadPodcastAudio', async () => {
      mockUploadPodcastAudio.mockReset().mockRejectedValue(new Error('R2 upload failed'));
      // Need to provide segment data since upload happens after segment processing
      mockPrismaSegmentFindMany.mockReset().mockResolvedValueOnce([
        { id: 'seg-1', audioUrl: 'https://r2.example.com/seg-1.mp3', order: 0, duration: 100 },
        { id: 'seg-2', audioUrl: 'https://r2.example.com/seg-2.mp3', order: 1, duration: 100 },
        { id: 'seg-3', audioUrl: 'https://r2.example.com/seg-3.mp3', order: 2, duration: 100 },
      ]);
      const job = createMockJob(defaultPayload);

      await expect(processAudioStitching(job)).rejects.toThrow('R2 upload failed');
    });

    it('queues Twitter failure reply when Twitter-sourced podcast fails', async () => {
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-1',
        title: 'Test Podcast',
        source: 'TWITTER',
        sourceTweetId: 'tweet-123',
        currentVersion: 0,
        audioUrl: null,
        user: { telegramEnabled: false, telegramChatId: null },
      });
      mockPrismaTweetMentionFindFirst.mockResolvedValue({
        id: 'mention-1',
        tweetId: 'tweet-123',
        status: 'GENERATING',
      });
      mockStitchWithEffects.mockRejectedValue(new Error('FFmpeg error'));
      const job = createMockJob(defaultPayload);

      await expect(processAudioStitching(job)).rejects.toThrow('FFmpeg error');

      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'twitter-reply' },
        'reply_twitter',
        expect.objectContaining({
          podcastId: 'podcast-001',
          tweetMentionId: 'mention-1',
        })
      );
    });
  });

  describe('end-to-end flow', () => {
    it('executes full pipeline for basic podcast (no SFX)', async () => {
      // Reset mocks and set up fresh data
      mockStitchWithEffects.mockReset().mockResolvedValue({ duration: 305.5 });
      mockReadFile.mockReset().mockResolvedValue(Buffer.alloc(1024 * 256));
      mockUploadPodcastAudio.mockReset().mockResolvedValue('https://cdn.sotto.fm/final.mp3');
      mockPrismaSegmentFindMany
        .mockReset()
        .mockResolvedValueOnce([
          { id: 'seg-1', audioUrl: 'https://r2.example.com/seg-1.mp3', order: 0, duration: 100 },
          { id: 'seg-2', audioUrl: 'https://r2.example.com/seg-2.mp3', order: 1, duration: 100 },
          { id: 'seg-3', audioUrl: 'https://r2.example.com/seg-3.mp3', order: 2, duration: 100 },
        ])
        .mockResolvedValueOnce([
          { id: 'seg-1', duration: 100 },
          { id: 'seg-2', duration: 100 },
          { id: 'seg-3', duration: 100 },
        ]);

      const job = createMockJob(defaultPayload);
      await processAudioStitching(job);

      // Segments fetched and ordered
      expect(mockPrismaSegmentFindMany).toHaveBeenCalled();

      // Podcast config fetched
      expect(mockPrismaPodcastFindUniqueOrThrow).toHaveBeenCalled();

      // Script fetched for sound cues
      expect(mockPrismaScriptFindUnique).toHaveBeenCalled();

      // Audio downloaded from R2
      expect(mockDownloadFile).toHaveBeenCalledTimes(3);

      // FFmpeg stitching called
      expect(mockStitchWithEffects).toHaveBeenCalled();

      // Final audio uploaded to R2
      expect(mockUploadPodcastAudio).toHaveBeenCalledWith('podcast-001', expect.any(Buffer));

      // Podcast updated to READY
      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: {
          status: 'READY',
          audioUrl: 'https://cdn.sotto.fm/final.mp3',
          duration: 306, // rounded
          durationDeviation: 6, // 306 - 5*60 = 6
          fileSize: 1024 * 256,
          currentVersion: 0,
        },
      });

      // Segment start times updated
      expect(mockPrismaSegmentUpdate).toHaveBeenCalledTimes(3);

      // Notification queued
      expect(mockAddJob).toHaveBeenCalledWith(
        expect.anything(),
        'send_notification',
        expect.anything()
      );

      // Temp cleaned up
      expect(mockRm).toHaveBeenCalled();

      // Progress reported to 100%
      expect(job.updateProgress).toHaveBeenCalledWith(100);
    });

    it('executes full pipeline for podcast with SFX', async () => {
      mockPrismaScriptFindUnique.mockResolvedValue({
        soundCues: [
          { type: 'intro', prompt: 'Warm piano intro', durationSeconds: 3, insertAfterTurn: 0 },
          { type: 'outro', prompt: 'Gentle piano outro', durationSeconds: 2, insertAfterTurn: 5 },
        ],
      });
      mockGenerateSoundEffect
        .mockResolvedValueOnce(Buffer.from('intro-sfx'))
        .mockResolvedValueOnce(Buffer.from('outro-sfx'));

      const job = createMockJob(defaultPayload);
      await processAudioStitching(job);

      // Premium SFX generated
      expect(mockGenerateSoundEffect).toHaveBeenCalledTimes(2);
      expect(mockGenerateSoundEffect).toHaveBeenCalledWith({
        prompt: 'Warm piano intro',
        durationSeconds: 3,
      });

      // SFX passed to stitcher
      const stitchCall = mockStitchWithEffects.mock.calls[0][0];
      expect(stitchCall.sfxInserts).toHaveLength(2);

      // Podcast completed successfully
      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: expect.objectContaining({ status: 'READY' }),
      });
    });

    it('executes full pipeline for Twitter-sourced podcast', async () => {
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        userId: 'user-1',
        title: 'Twitter Podcast',
        source: 'TWITTER',
        sourceTweetId: 'tweet-789',
        currentVersion: 0,
        audioUrl: null,
        user: { telegramEnabled: false, telegramChatId: null },
      });
      mockPrismaTweetMentionFindFirst.mockResolvedValue({
        id: 'mention-2',
        tweetId: 'tweet-789',
        status: 'GENERATING',
      });

      const job = createMockJob(defaultPayload);
      await processAudioStitching(job);

      // Notification queued
      expect(mockAddJob).toHaveBeenCalledWith(
        expect.anything(),
        'send_notification',
        expect.anything()
      );

      // Twitter reply queued
      expect(mockAddJob).toHaveBeenCalledWith({ name: 'twitter-reply' }, 'reply_twitter', {
        podcastId: 'podcast-001',
        tweetMentionId: 'mention-2',
        originalTweetId: 'tweet-789',
      });

      // Mention status updated
      expect(mockPrismaTweetMentionUpdate).toHaveBeenCalledWith({
        where: { id: 'mention-2' },
        data: { status: 'READY' },
      });

      // Podcast completed
      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: expect.objectContaining({ status: 'READY' }),
      });
    });
  });
});
