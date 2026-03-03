import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- File system and process mocks (must come first) ----

const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockRm = vi.fn().mockResolvedValue(undefined);
const mockStat = vi.fn().mockResolvedValue({ size: 1024000 });
const mockReadFile = vi.fn().mockResolvedValue(Buffer.alloc(100));

vi.mock('fs/promises', () => {
  const mod = {
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    mkdir: (...args: unknown[]) => mockMkdir(...args),
    rm: (...args: unknown[]) => mockRm(...args),
    stat: (...args: unknown[]) => mockStat(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
  };
  return { ...mod, default: mod };
});

const mockExecFileAsync = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });

vi.mock('util', () => {
  const mod = { promisify: vi.fn().mockReturnValue((...args: unknown[]) => mockExecFileAsync(...args)) };
  return { ...mod, default: mod };
});

vi.mock('child_process', () => {
  const mod = { execFile: vi.fn() };
  return { ...mod, default: mod };
});

// ---- Prisma mocks ----

const mockPrismaPodcastVersionFindFirst = vi.fn().mockResolvedValue(null);
const mockPrismaPodcastVersionCreate = vi.fn().mockResolvedValue({ id: 'version-001', version: 1 });
const mockPrismaPodcastVersionSegmentCreate = vi.fn().mockResolvedValue({});
const mockPrismaPodcastFindUniqueOrThrow = vi.fn();
const mockPrismaPodcastUpdate = vi.fn().mockResolvedValue({});
const mockPrismaScriptFindUnique = vi.fn().mockResolvedValue(null);
const mockPrismaScriptCreate = vi.fn().mockResolvedValue({ id: 'script-001' });
const mockPrismaSegmentCreate = vi.fn();
const mockPrismaSegmentUpdate = vi.fn().mockResolvedValue({});
const mockPrismaTagFindUnique = vi.fn().mockResolvedValue(null);
const mockPrismaPodcastTagUpsert = vi.fn().mockResolvedValue({});
const mockPrismaUserFindUniqueOrThrow = vi.fn().mockResolvedValue({ role: 'USER', plan: 'FREE' });

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    podcastVersion: {
      findFirst: (...args: unknown[]) => mockPrismaPodcastVersionFindFirst(...args),
      create: (...args: unknown[]) => mockPrismaPodcastVersionCreate(...args),
    },
    podcast: {
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaPodcastFindUniqueOrThrow(...args),
      update: (...args: unknown[]) => mockPrismaPodcastUpdate(...args),
    },
    script: {
      findUnique: (...args: unknown[]) => mockPrismaScriptFindUnique(...args),
      create: (...args: unknown[]) => mockPrismaScriptCreate(...args),
    },
    segment: {
      create: (...args: unknown[]) => mockPrismaSegmentCreate(...args),
      update: (...args: unknown[]) => mockPrismaSegmentUpdate(...args),
    },
    podcastVersionSegment: {
      create: (...args: unknown[]) => mockPrismaPodcastVersionSegmentCreate(...args),
    },
    tag: {
      findUnique: (...args: unknown[]) => mockPrismaTagFindUnique(...args),
    },
    podcastTag: {
      upsert: (...args: unknown[]) => mockPrismaPodcastTagUpsert(...args),
    },
    user: {
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaUserFindUniqueOrThrow(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

// ---- R2 mocks ----

const mockDownloadFile = vi.fn().mockResolvedValue(Buffer.from('audio-data'));
const mockUploadPodcastAudio = vi.fn().mockResolvedValue('https://r2.example.com/final.mp3');
const mockDeleteFile = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/r2', () => ({
  downloadFile: (...args: unknown[]) => mockDownloadFile(...args),
  uploadPodcastAudio: (...args: unknown[]) => mockUploadPodcastAudio(...args),
  deleteFile: (...args: unknown[]) => mockDeleteFile(...args),
}));

// ---- Audio + STT mocks ----

const mockGetAudioDuration = vi.fn().mockResolvedValue(360);
vi.mock('@/lib/audio-stitcher', () => ({
  getAudioDuration: (...args: unknown[]) => mockGetAudioDuration(...args),
}));

const mockTranscribe = vi.fn().mockResolvedValue({
  segments: [
    { start: 0, end: 10, text: 'Hello world.' },
    { start: 10, end: 20, text: 'Welcome to the show.' },
  ],
});
const mockCreateSttProvider = vi.fn().mockReturnValue({
  transcribe: (...args: unknown[]) => mockTranscribe(...args),
});
vi.mock('@/lib/providers/stt', () => ({
  createSttProvider: (...args: unknown[]) => mockCreateSttProvider(...args),
}));

const mockGetSttProviderMeta = vi.fn().mockReturnValue({
  defaultModel: 'whisper-1',
  platformCostPerMinute: 0.006,
});
vi.mock('@/lib/providers/stt-registry', () => ({
  getSttProviderMeta: (...args: unknown[]) => mockGetSttProviderMeta(...args),
}));

// ---- Transcript processing mocks ----

const defaultSegments = [
  { speaker: 'HOST', text: 'Hello world.', order: 0, startTime: 0, endTime: 10 },
  { speaker: 'EXPERT', text: 'Welcome to the show.', order: 1, startTime: 10, endTime: 20 },
];

const mockParseTranscript = vi.fn().mockResolvedValue(defaultSegments);
const mockDiarizeSpeakers = vi.fn().mockResolvedValue(defaultSegments);

vi.mock('@/lib/transcript-parser', () => ({
  parseTranscript: (...args: unknown[]) => mockParseTranscript(...args),
  diarizeSpeakers: (...args: unknown[]) => mockDiarizeSpeakers(...args),
}));

// ---- Metadata mocks ----

const mockGenerateImportMetadata = vi.fn().mockResolvedValue({
  title: 'AI-Generated Title',
  topic: 'Quantum Computing Fundamentals',
});
const mockIsMetadataDifferent = vi.fn().mockReturnValue(true);

vi.mock('@/lib/import-metadata-generator', () => ({
  generateImportMetadata: (...args: unknown[]) => mockGenerateImportMetadata(...args),
  isMetadataDifferent: (...args: unknown[]) => mockIsMetadataDifferent(...args),
}));

// ---- Language + topic tag mocks ----

const mockDetectLanguage = vi.fn().mockReturnValue('en');
vi.mock('@/lib/language-detect', () => ({
  detectLanguage: (...args: unknown[]) => mockDetectLanguage(...args),
}));

const mockMatchTopicTags = vi.fn().mockReturnValue([]);
vi.mock('@/lib/topic-tagger', () => ({
  matchTopicTags: (...args: unknown[]) => mockMatchTopicTags(...args),
  TAG_PARENT_MAP: {} as Record<string, string | null>,
}));

// ---- Misc mocks ----

const mockMarkPodcastFailed = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/pipeline-resume', () => ({
  markPodcastFailed: (...args: unknown[]) => mockMarkPodcastFailed(...args),
}));

const mockLogUsage = vi.fn();
vi.mock('@/lib/usage-logger', () => ({
  logUsage: (...args: unknown[]) => mockLogUsage(...args),
}));

vi.mock('@/lib/byok', () => ({
  getAiKey: vi.fn().mockResolvedValue(null),
  hasByokKey: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/lib/providers/ai-registry', () => ({
  resolveAiModelAndProvider: vi.fn().mockResolvedValue({ model: 'claude-haiku-4-5-20251001', provider: 'anthropic' }),
  getCheapestModelForProvider: vi.fn().mockReturnValue('claude-haiku-4-5-20251001'),
}));

const mockConsumeFreeGeneration = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/generation-gate', () => ({
  consumeFreeGeneration: (...args: unknown[]) => mockConsumeFreeGeneration(...args),
}));

const mockAddJob = vi.fn().mockResolvedValue({ id: 'job-1' });
vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: { SEND_NOTIFICATION: 'send_notification', COMPUTE_FEATURES: 'compute_features' },
  notificationQueue: { name: 'notifications' },
  featureComputationQueue: { name: 'feature-computation' },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---- Import under test ----
import { processAudioImport } from '@/workers/audio-import.worker';
import type { ImportAudioPayload } from '@/lib/queue';
import type { Job } from 'bullmq';

// ---- Helpers ----

function createMockJob(data: ImportAudioPayload): Job<ImportAudioPayload> {
  return {
    data,
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<ImportAudioPayload>;
}

// Combined podcast record that satisfies all select queries
const mockPodcastRecord = {
  duration: null,
  fileSize: null,
  title: 'Original Title',
  topic: 'Original Topic',
  suggestedTopic: null,
  isHumanContent: false,
  currentVersion: 0,
  audioUrl: null,
};

const defaultPayload: ImportAudioPayload = {
  podcastId: 'podcast-001',
  userId: 'user-001',
  audioKey: 'uploads/audio-001.mp3',
  isHumanContent: false,
  generateMetadata: true,
};

// ---- Tests ----

describe('processAudioImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockPrismaPodcastVersionFindFirst.mockResolvedValue(null);
    mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue(mockPodcastRecord);
    mockPrismaPodcastUpdate.mockResolvedValue({});
    mockPrismaScriptFindUnique.mockResolvedValue(null);
    mockPrismaScriptCreate.mockResolvedValue({ id: 'script-001' });
    mockPrismaSegmentCreate.mockImplementation(
      ({ data }: { data: { order: number } }) => Promise.resolve({ id: `seg-${data.order}`, ...data })
    );
    mockPrismaSegmentUpdate.mockResolvedValue({});
    mockPrismaPodcastVersionCreate.mockResolvedValue({ id: 'version-001', version: 1 });
    mockPrismaPodcastVersionSegmentCreate.mockResolvedValue({});
    mockPrismaTagFindUnique.mockResolvedValue(null);
    mockPrismaPodcastTagUpsert.mockResolvedValue({});

    mockDownloadFile.mockResolvedValue(Buffer.from('audio-data'));
    mockUploadPodcastAudio.mockResolvedValue('https://r2.example.com/final.mp3');
    mockDeleteFile.mockResolvedValue(undefined);

    mockGetAudioDuration.mockResolvedValue(360);
    mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
    mockStat.mockResolvedValue({ size: 1024000 });
    mockReadFile.mockResolvedValue(Buffer.alloc(100));

    mockTranscribe.mockResolvedValue({
      segments: [
        { start: 0, end: 10, text: 'Hello world.' },
        { start: 10, end: 20, text: 'Welcome to the show.' },
      ],
    });
    mockCreateSttProvider.mockReturnValue({ transcribe: (...args: unknown[]) => mockTranscribe(...args) });
    mockGetSttProviderMeta.mockReturnValue({ defaultModel: 'whisper-1', platformCostPerMinute: 0.006 });

    mockParseTranscript.mockResolvedValue(defaultSegments);
    mockDiarizeSpeakers.mockResolvedValue(defaultSegments);

    mockGenerateImportMetadata.mockResolvedValue({ title: 'AI-Generated Title', topic: 'Quantum Computing Fundamentals' });
    mockIsMetadataDifferent.mockReturnValue(true);
    mockDetectLanguage.mockReturnValue('en');
    mockMatchTopicTags.mockReturnValue([]);

    mockMarkPodcastFailed.mockResolvedValue(undefined);
    mockAddJob.mockResolvedValue({ id: 'job-1' });
  });

  describe('idempotency', () => {
    it('skips the full import when PodcastVersion with audioUrl already exists', async () => {
      mockPrismaPodcastVersionFindFirst.mockResolvedValue({
        audioUrl: 'https://r2.example.com/existing.mp3',
        version: 1,
        id: 'version-001',
      });

      const job = createMockJob(defaultPayload);
      await processAudioImport(job);

      expect(mockDownloadFile).not.toHaveBeenCalled();
      expect(mockExecFileAsync).not.toHaveBeenCalled();
      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'READY' }) })
      );
    });

    it('does not create Script when it already exists (mid-import retry guard)', async () => {
      mockPrismaScriptFindUnique.mockResolvedValue({ id: 'existing-script' });

      const job = createMockJob({ ...defaultPayload, transcriptText: 'Host: Hello.\nExpert: Hi.' });
      await processAudioImport(job);

      expect(mockPrismaScriptCreate).not.toHaveBeenCalled();
    });
  });

  describe('transcript path (transcriptText provided)', () => {
    it('calls parseTranscript and skips STT provider', async () => {
      const job = createMockJob({ ...defaultPayload, transcriptText: 'Host: Hello.\nExpert: Hi.' });
      await processAudioImport(job);

      expect(mockParseTranscript).toHaveBeenCalledWith('Host: Hello.\nExpert: Hi.');
      expect(mockCreateSttProvider).not.toHaveBeenCalled();
    });

    it('skips diarization when parsed transcript already has multiple speakers', async () => {
      mockParseTranscript.mockResolvedValue(defaultSegments); // has HOST + EXPERT (2 unique)

      const job = createMockJob({ ...defaultPayload, transcriptText: 'Host: Hi.\nExpert: Hello.' });
      await processAudioImport(job);

      expect(mockDiarizeSpeakers).not.toHaveBeenCalled();
    });

    it('runs diarization when parsed transcript has only one unique speaker', async () => {
      mockParseTranscript.mockResolvedValue([
        { speaker: 'HOST' , text: 'First.', order: 0, startTime: 0, endTime: 5 },
        { speaker: 'HOST' , text: 'Second.', order: 1, startTime: 5, endTime: 10 },
      ]);

      const job = createMockJob({ ...defaultPayload, transcriptText: 'Monologue transcript' });
      await processAudioImport(job);

      expect(mockDiarizeSpeakers).toHaveBeenCalled();
    });
  });

  describe('STT path (no transcript)', () => {
    it('creates STT provider with specified provider and key', async () => {
      const job = createMockJob({ ...defaultPayload, sttProvider: 'elevenlabs', sttApiKey: 'el-key-abc' });
      await processAudioImport(job);

      expect(mockCreateSttProvider).toHaveBeenCalledWith('elevenlabs', 'el-key-abc', undefined);
    });

    it('runs diarization on STT transcription output', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioImport(job);

      expect(mockTranscribe).toHaveBeenCalled();
      expect(mockDiarizeSpeakers).toHaveBeenCalled();
    });

    it('logs STT usage with cost proportional to audio duration', async () => {
      mockGetAudioDuration.mockResolvedValue(120); // 2 minutes
      mockGetSttProviderMeta.mockReturnValue({ defaultModel: 'whisper-1', platformCostPerMinute: 0.006 });

      const job = createMockJob(defaultPayload);
      await processAudioImport(job);

      expect(mockLogUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'stt_transcription',
          totalCost: (120 / 60) * 0.006,
        })
      );
    });
  });

  describe('audio normalization', () => {
    it('downloads audio from R2 before processing', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioImport(job);

      expect(mockDownloadFile).toHaveBeenCalledWith('uploads/audio-001.mp3');
    });

    it('runs FFmpeg loudnorm normalization', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioImport(job);

      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'ffmpeg',
        expect.arrayContaining(['-filter:a', 'loudnorm=I=-16:TP=-1.5:LRA=11'])
      );
    });

    it('uploads normalized audio to R2', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioImport(job);

      expect(mockUploadPodcastAudio).toHaveBeenCalledWith('podcast-001', expect.any(Buffer));
    });
  });

  describe('metadata generation', () => {
    it('applies AI metadata directly when generateMetadata is true', async () => {
      const job = createMockJob({ ...defaultPayload, generateMetadata: true });
      await processAudioImport(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'AI-Generated Title',
            topic: 'Quantum Computing Fundamentals',
          }),
        })
      );
    });

    it('stores suggestions when generateMetadata is false and AI title differs from current', async () => {
      mockIsMetadataDifferent.mockReturnValue(true);

      const job = createMockJob({ ...defaultPayload, generateMetadata: false });
      await processAudioImport(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ suggestedTitle: 'AI-Generated Title' }),
        })
      );
    });

    it('does not store suggestions when AI title and topic match current metadata', async () => {
      mockIsMetadataDifferent.mockReturnValue(false);
      // suggestedTopic path: topic is present but isMetadataDifferent returns false → topicDifferent = false
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        ...mockPodcastRecord,
        topic: 'Same Topic', // non-null so topicDifferent uses isMetadataDifferent
      });

      const job = createMockJob({ ...defaultPayload, generateMetadata: false });
      await processAudioImport(job);

      const suggestionCall = mockPrismaPodcastUpdate.mock.calls.find(
        (c: unknown[]) => (c[0] as { data?: { suggestedTitle?: unknown } })?.data?.suggestedTitle !== undefined
      );
      expect(suggestionCall).toBeUndefined();
    });

    it('continues without failing when metadata generation throws', async () => {
      mockGenerateImportMetadata.mockRejectedValue(new Error('Claude timeout'));

      const job = createMockJob(defaultPayload);
      await expect(processAudioImport(job)).resolves.not.toThrow();
    });
  });

  describe('script and segment creation', () => {
    it('creates Script record from diarized segments', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioImport(job);

      expect(mockPrismaScriptCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            podcastId: 'podcast-001',
            version: 1,
          }),
        })
      );
    });

    it('creates one Segment record per diarized segment', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioImport(job);

      expect(mockPrismaSegmentCreate).toHaveBeenCalledTimes(defaultSegments.length);
    });

    it('creates PodcastVersion with correct fields', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioImport(job);

      expect(mockPrismaPodcastVersionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            podcastId: 'podcast-001',
            version: 1,
            changeType: 'initial',
            audioUrl: 'https://r2.example.com/final.mp3',
          }),
        })
      );
    });

    it('creates PodcastVersionSegment for each segment', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioImport(job);

      expect(mockPrismaPodcastVersionSegmentCreate).toHaveBeenCalledTimes(defaultSegments.length);
    });
  });

  describe('status flow', () => {
    it('transitions through IMPORTING → TRANSCRIBING → READY in order', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioImport(job);

      const statuses = mockPrismaPodcastUpdate.mock.calls
        .map((c: unknown[]) => (c[0] as { data?: { status?: string } })?.data?.status)
        .filter(Boolean);

      const importingIdx = statuses.indexOf('IMPORTING');
      const transcribingIdx = statuses.indexOf('TRANSCRIBING');
      const readyIdx = statuses.indexOf('READY');

      expect(importingIdx).toBeGreaterThanOrEqual(0);
      expect(transcribingIdx).toBeGreaterThan(importingIdx);
      expect(readyIdx).toBeGreaterThan(transcribingIdx);
    });

    it('sets READY with audioUrl, duration, and fileSize', async () => {
      mockGetAudioDuration.mockResolvedValue(300);
      mockStat.mockResolvedValue({ size: 5000000 });
      mockUploadPodcastAudio.mockResolvedValue('https://r2.example.com/final.mp3');

      const job = createMockJob(defaultPayload);
      await processAudioImport(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'podcast-001' },
          data: expect.objectContaining({
            status: 'READY',
            audioUrl: 'https://r2.example.com/final.mp3',
            duration: 300,
            fileSize: 5000000,
          }),
        })
      );
    });
  });

  describe('post-import tasks', () => {
    it('queues PODCAST_READY notification on completion', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioImport(job);

      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'notifications' },
        'send_notification',
        expect.objectContaining({ userId: 'user-001', type: 'PODCAST_READY' })
      );
    });

    it('deletes original imported audio from R2 after upload', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioImport(job);

      expect(mockDeleteFile).toHaveBeenCalledWith('uploads/audio-001.mp3');
    });

    it('cleans up tmp directory on success', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioImport(job);

      expect(mockRm).toHaveBeenCalledWith(
        expect.stringContaining('sotto-import-'),
        { recursive: true, force: true }
      );
    });
  });

  describe('language and topic tagging', () => {
    it('detects language from transcript text', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioImport(job);

      expect(mockDetectLanguage).toHaveBeenCalledWith(
        expect.stringContaining('Hello world.')
      );
    });

    it('assigns language tag when detected language matches an existing tag', async () => {
      mockDetectLanguage.mockReturnValue('en');
      mockPrismaTagFindUnique.mockResolvedValue({ id: 'tag-lang-en', slug: 'lang-en' });

      const job = createMockJob(defaultPayload);
      await processAudioImport(job);

      expect(mockPrismaPodcastTagUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { podcastId_tagId: { podcastId: 'podcast-001', tagId: 'tag-lang-en' } } })
      );
    });

    it('skips language tag assignment when detectLanguage returns null', async () => {
      mockDetectLanguage.mockReturnValue(null);

      const job = createMockJob(defaultPayload);
      await processAudioImport(job);

      const langTagCalls = mockPrismaPodcastTagUpsert.mock.calls.filter(
        (c: unknown[]) => JSON.stringify(c).includes('lang-')
      );
      expect(langTagCalls).toHaveLength(0);
    });
  });

  describe('progress tracking', () => {
    it('reports monotonically increasing progress ending at 100', async () => {
      const job = createMockJob(defaultPayload);
      await processAudioImport(job);

      const calls = (job.updateProgress as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => c[0] as number
      );
      for (let i = 1; i < calls.length; i++) {
        expect(calls[i]).toBeGreaterThanOrEqual(calls[i - 1]);
      }
      expect(calls[calls.length - 1]).toBe(100);
    });
  });

  describe('error handling', () => {
    it('marks podcast failed and rethrows on R2 download error', async () => {
      mockDownloadFile.mockRejectedValue(new Error('R2 network error'));
      const job = createMockJob(defaultPayload);

      await expect(processAudioImport(job)).rejects.toThrow('R2 network error');
      expect(mockMarkPodcastFailed).toHaveBeenCalledWith('podcast-001', {
        technicalError: 'R2 network error',
      });
    });

    it('marks podcast failed and rethrows on FFmpeg error', async () => {
      mockExecFileAsync.mockRejectedValue(new Error('FFmpeg: Invalid data found'));
      const job = createMockJob(defaultPayload);

      await expect(processAudioImport(job)).rejects.toThrow('FFmpeg: Invalid data found');
      expect(mockMarkPodcastFailed).toHaveBeenCalledWith('podcast-001', {
        technicalError: 'FFmpeg: Invalid data found',
      });
    });

    it('marks podcast failed and rethrows on STT transcription error', async () => {
      mockTranscribe.mockRejectedValue(new Error('STT quota exceeded'));
      const job = createMockJob(defaultPayload);

      await expect(processAudioImport(job)).rejects.toThrow('STT quota exceeded');
      expect(mockMarkPodcastFailed).toHaveBeenCalledWith('podcast-001', {
        technicalError: 'STT quota exceeded',
      });
    });

    it('marks podcast failed and rethrows on R2 upload error', async () => {
      mockUploadPodcastAudio.mockRejectedValue(new Error('R2 upload failed'));
      const job = createMockJob(defaultPayload);

      await expect(processAudioImport(job)).rejects.toThrow('R2 upload failed');
      expect(mockMarkPodcastFailed).toHaveBeenCalledWith('podcast-001', {
        technicalError: 'R2 upload failed',
      });
    });

    it('cleans up tmp directory even when an error occurs', async () => {
      mockExecFileAsync.mockRejectedValue(new Error('FFmpeg crashed'));
      const job = createMockJob(defaultPayload);

      await expect(processAudioImport(job)).rejects.toThrow();
      expect(mockRm).toHaveBeenCalledWith(
        expect.stringContaining('sotto-import-'),
        { recursive: true, force: true }
      );
    });
  });
});
