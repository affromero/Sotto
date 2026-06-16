import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Prisma mock ----

const mockSpeakingRecordingFindUnique = vi.fn();
const mockSpeakingRecordingUpdate = vi.fn().mockResolvedValue({});
const mockClassSectionFindUnique = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mock = {
    speakingRecording: {
      findUnique: (...args: unknown[]) => mockSpeakingRecordingFindUnique(...args),
      update: (...args: unknown[]) => mockSpeakingRecordingUpdate(...args),
    },
    classSection: {
      findUnique: (...args: unknown[]) => mockClassSectionFindUnique(...args),
    },
  };
  return { prisma: _mock, prismaUnfiltered: _mock };
});

// ---- BYOK mock ----

const mockGetAiKey = vi.fn().mockResolvedValue({ apiKey: 'test-ai-key', provider: 'anthropic' });

vi.mock('@/lib/byok', () => ({
  getAiKey: (...args: unknown[]) => mockGetAiKey(...args),
}));

// ---- AI registry mock ----

vi.mock('@/lib/providers/ai-registry', () => ({
  getAiProviderMeta: vi.fn().mockReturnValue({ defaultModel: 'claude-haiku-4-5-20251001' }),
}));

// ---- STT mock ----

const mockTranscribe = vi.fn().mockResolvedValue({
  text: 'Guten Morgen',
  segments: [],
  words: [
    { word: 'Guten', start: 0.0, end: 0.5 },
    { word: 'Morgen', start: 0.6, end: 1.1 },
  ],
});

const mockResolveSttProvider = vi.fn().mockResolvedValue({
  providerId: 'openai',
  apiKey: 'stt-key',
  model: 'whisper-1',
  source: 'platform',
});

const mockCreateSttProvider = vi.fn().mockReturnValue({
  transcribe: (...args: unknown[]) => mockTranscribe(...args),
});

vi.mock('@/lib/providers/stt', () => ({
  resolveSttProvider: (...args: unknown[]) => mockResolveSttProvider(...args),
  createSttProvider: (...args: unknown[]) => mockCreateSttProvider(...args),
  getConfiguredSttProviderId: () => 'openai',
}));

// ---- Scorer mock ----

const mockScore = vi.fn().mockResolvedValue({
  overallScore: 0.82,
  rubricScores: { accuracy: 0.85, fluency: 0.78, completeness: 0.90 },
  feedback: 'Good attempt! Focus on the final consonant.',
  phonemeScores: [{ op: 'match', expected: 'guten', actual: 'guten' }],
  transcript: 'Guten Morgen',
});

const mockResolvePronunciationScorer = vi.fn().mockReturnValue({
  score: (...args: unknown[]) => mockScore(...args),
});

vi.mock('@/lib/pronunciation/scorer', () => ({
  resolvePronunciationScorer: (...args: unknown[]) => mockResolvePronunciationScorer(...args),
}));

// ---- Logger mock ----

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---- Global fetch mock ----

const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
});
vi.stubGlobal('fetch', mockFetch);

// ---- Import under test ----

import { processSpeakingGrading } from '@/workers/speaking-grading.worker';
import type { SpeakingGradingPayload } from '@/lib/queue';
import type { Job } from 'bullmq';

// ---- Helpers ----

function makeJob(data: SpeakingGradingPayload): Job<SpeakingGradingPayload> {
  return {
    data,
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<SpeakingGradingPayload>;
}

const SAMPLE_RECORDING = {
  id: 'rec-001',
  sectionId: 'sec-001',
  promptId: 'prompt-001',
  userId: 'user-001',
  audioUrl: 'https://r2.example.com/speaking/user-001/prompt-001/abc.webm',
  status: 'PENDING',
  prompt: { targetPhrase: 'Guten Morgen' },
  user: { id: 'user-001', preferredSttModel: null },
};

const SAMPLE_SECTION = {
  classId: 'class-001',
  class: {
    course: { targetLang: 'de' },
  },
};

// ---- Tests ----

describe('processSpeakingGrading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSpeakingRecordingFindUnique.mockResolvedValue(SAMPLE_RECORDING);
    mockClassSectionFindUnique.mockResolvedValue(SAMPLE_SECTION);
    mockSpeakingRecordingUpdate.mockResolvedValue({});
    mockGetAiKey.mockResolvedValue({ apiKey: 'test-ai-key', provider: 'anthropic' });
    mockScore.mockResolvedValue({
      overallScore: 0.82,
      rubricScores: { accuracy: 0.85, fluency: 0.78, completeness: 0.90 },
      feedback: 'Good attempt!',
      phonemeScores: [{ op: 'match', expected: 'guten', actual: 'guten' }],
      transcript: 'Guten Morgen',
    });
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
    });
    mockTranscribe.mockResolvedValue({
      text: 'Guten Morgen',
      segments: [],
      words: [{ word: 'Guten', start: 0.0, end: 0.5 }, { word: 'Morgen', start: 0.6, end: 1.1 }],
    });
  });

  describe('happy path — SCORED update', () => {
    it('updates recording to SCORED with all scored fields', async () => {
      const job = makeJob({ recordingId: 'rec-001' });
      await processSpeakingGrading(job);

      // Should have set GRADING first
      expect(mockSpeakingRecordingUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'rec-001' }, data: { status: 'GRADING' } })
      );

      // Final SCORED update
      expect(mockSpeakingRecordingUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rec-001' },
          data: expect.objectContaining({
            status: 'SCORED',
            transcript: 'Guten Morgen',
            overallScore: 0.82,
            feedback: 'Good attempt!',
          }),
        })
      );
    });

    it('persists rubricScores and phonemeScores', async () => {
      const job = makeJob({ recordingId: 'rec-001' });
      await processSpeakingGrading(job);

      type UpdateArg = { data?: { status?: string; rubricScores?: unknown; phonemeScores?: unknown } };
      const scoredCall = (mockSpeakingRecordingUpdate.mock.calls as Array<[UpdateArg]>).find(
        ([arg]) => arg.data?.status === 'SCORED'
      );
      expect(scoredCall).toBeDefined();
      const scoredData = scoredCall![0].data!;
      expect(scoredData.rubricScores).toEqual({
        accuracy: 0.85,
        fluency: 0.78,
        completeness: 0.90,
      });
      expect(scoredData.phonemeScores).toEqual([
        { op: 'match', expected: 'guten', actual: 'guten' },
      ]);
    });

    it('calls scorer with targetPhrase, transcript, wordTimings and targetLang', async () => {
      const job = makeJob({ recordingId: 'rec-001' });
      await processSpeakingGrading(job);

      expect(mockScore).toHaveBeenCalledWith(
        expect.objectContaining({
          targetPhrase: 'Guten Morgen',
          transcript: 'Guten Morgen',
          targetLang: 'de',
          wordTimings: [
            { word: 'Guten', start: 0.0, end: 0.5 },
            { word: 'Morgen', start: 0.6, end: 1.1 },
          ],
        })
      );
    });

    it('passes AI provider + model from BYOK key', async () => {
      const job = makeJob({ recordingId: 'rec-001' });
      await processSpeakingGrading(job);

      expect(mockScore).toHaveBeenCalledWith(
        expect.objectContaining({
          aiProvider: 'anthropic',
          aiModel: 'claude-haiku-4-5-20251001',
          aiApiKey: 'test-ai-key',
          userId: 'user-001',
        })
      );
    });

    it('reports monotonically increasing progress ending at 100', async () => {
      const job = makeJob({ recordingId: 'rec-001' });
      await processSpeakingGrading(job);

      const calls = (job.updateProgress as ReturnType<typeof vi.fn>).mock.calls.map(
        ([p]) => p as number
      );
      for (let i = 1; i < calls.length; i++) {
        expect(calls[i]).toBeGreaterThanOrEqual(calls[i - 1]);
      }
      expect(calls[calls.length - 1]).toBe(100);
    });
  });

  describe('error handling — FAILED status', () => {
    it('sets status FAILED and rethrows when recording not found', async () => {
      mockSpeakingRecordingFindUnique.mockResolvedValue(null);
      const job = makeJob({ recordingId: 'rec-missing' });

      await expect(processSpeakingGrading(job)).rejects.toThrow('SpeakingRecording not found');
      // No update to FAILED since we throw before marking GRADING
      expect(mockSpeakingRecordingUpdate).not.toHaveBeenCalled();
    });

    it('sets status FAILED and rethrows when audio download fails', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });
      const job = makeJob({ recordingId: 'rec-001' });

      await expect(processSpeakingGrading(job)).rejects.toThrow();
      expect(mockSpeakingRecordingUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'FAILED' } })
      );
    });

    it('sets status FAILED and rethrows when STT transcription throws', async () => {
      mockTranscribe.mockRejectedValue(new Error('STT rate limit'));
      const job = makeJob({ recordingId: 'rec-001' });

      await expect(processSpeakingGrading(job)).rejects.toThrow('STT rate limit');
      expect(mockSpeakingRecordingUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'FAILED' } })
      );
    });

    it('sets status FAILED and rethrows when no AI provider is available', async () => {
      mockGetAiKey.mockResolvedValue(null);
      const prev = process.env.AI_PROVIDER;
      process.env.AI_PROVIDER = '';
      const job = makeJob({ recordingId: 'rec-001' });

      try {
        await expect(processSpeakingGrading(job)).rejects.toThrow(/AI provider/i);
      } finally {
        process.env.AI_PROVIDER = prev;
      }
      expect(mockSpeakingRecordingUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'FAILED' } })
      );
    });

    it('sets status FAILED and rethrows when scorer throws', async () => {
      mockScore.mockRejectedValue(new Error('LLM timeout'));
      const job = makeJob({ recordingId: 'rec-001' });

      await expect(processSpeakingGrading(job)).rejects.toThrow('LLM timeout');
      expect(mockSpeakingRecordingUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'FAILED' } })
      );
    });
  });

  describe('STT integration', () => {
    it('downloads audio from the recording audioUrl', async () => {
      const job = makeJob({ recordingId: 'rec-001' });
      await processSpeakingGrading(job);

      expect(mockFetch).toHaveBeenCalledWith(SAMPLE_RECORDING.audioUrl);
    });

    it('passes targetLang to STT transcribe', async () => {
      const job = makeJob({ recordingId: 'rec-001' });
      await processSpeakingGrading(job);

      expect(mockTranscribe).toHaveBeenCalledWith(expect.any(Buffer), { language: 'de' });
    });

    it('resolves STT for the recording userId', async () => {
      const job = makeJob({ recordingId: 'rec-001' });
      await processSpeakingGrading(job);

      expect(mockResolveSttProvider).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-001' })
      );
    });

    it('passes the learner preferred STT model to provider resolution', async () => {
      mockSpeakingRecordingFindUnique.mockResolvedValue({
        ...SAMPLE_RECORDING,
        user: { id: 'user-001', preferredSttModel: 'gpt-4o-transcribe' },
      });

      const job = makeJob({ recordingId: 'rec-001' });
      await processSpeakingGrading(job);

      expect(mockResolveSttProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-001',
          requestedProvider: 'openai',
          requestedModel: 'gpt-4o-transcribe',
          language: 'de',
        })
      );
    });
  });
});
