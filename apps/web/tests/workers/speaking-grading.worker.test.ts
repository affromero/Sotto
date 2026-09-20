import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import type { SpeakingGradingPayload } from '@/lib/queue';

const mocks = vi.hoisted(() => {
  const ownership = {
    instanceId: 'instance-1',
    scopes: [{ subjectId: 'profile:user-1', generation: 1 }],
    reference: 'https://storage.example/recording.webm',
    associations: {
      recordingId: 'recording-1',
      createdAt: new Date('2026-01-01T00:00:00Z').getTime(),
      userId: 'user-1',
      prompt: {
        promptId: 'prompt-1',
        createdAt: new Date('2026-01-01T00:00:00Z').getTime(),
        parents: [{ kind: 'class', id: 'section-1', courseId: 'course-1', parentId: 'class-1' }],
      },
      parents: [{ kind: 'class', id: 'section-1', courseId: 'course-1', parentId: 'class-1' }],
    },
  };
  const update = vi.fn().mockResolvedValue({});
  const recording = {
    id: 'recording-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    sectionId: 'section-1',
    practiceSessionId: null,
    examSectionId: null,
    promptId: 'prompt-1',
    userId: 'user-1',
    audioUrl: '/api/storage/recording.webm',
    status: 'PENDING',
    prompt: { targetPhrase: 'Guten Morgen' },
    user: { id: 'user-1', preferredSttModel: null },
  };
  const database = {
    speakingRecording: { findUnique: vi.fn(), update },
    classSection: { findUnique: vi.fn() },
    practiceSession: { findUnique: vi.fn() },
    examSection: { findUnique: vi.fn() },
  };
  const storageInput = {
    consumer: 'recording:recording-1:audio',
    reference: recording.audioUrl,
    assetId: 'a'.repeat(64),
    backendId: 'b'.repeat(64),
    binding: 'c'.repeat(64),
    key: 'speaking/recording.webm',
  };
  const backend = { descriptor: { kind: 'local', identity: { binding: 'binding' } } };
  return {
    update,
    recording,
    database,
    storageInput,
    backend,
    ownership,
    resolveStorageInput: vi.fn().mockResolvedValue({ input: storageInput, backend }),
    validateStorageInputs: vi.fn().mockResolvedValue([backend]),
    markCleanupUnconfirmed: vi.fn(),
    transcribe: vi.fn(),
    authenticatedFetch: vi.fn(async (_request, _init, observation) => {
      observation?.onDispatch();
      observation?.onConsumed?.({ status: 200 });
      return new Response('{}');
    }),
    score: vi.fn(async (input: { fetch?: typeof fetch }) => {
      const response = await input.fetch?.('https://api.anthropic.com/v1/messages', {
        method: 'POST',
      });
      await response?.text();
      return {
        transcript: 'Guten Morgen',
        overallScore: 0.9,
        rubricScores: { accuracy: 0.9, fluency: 0.9, completeness: 0.9 },
        phonemeScores: [],
        feedback: 'Good work',
      };
    }),
  };
});

vi.mock('@/lib/prisma', () => ({ prismaUnfiltered: mocks.database }));
vi.mock('@/lib/sidedoor/access/state/transaction', () => ({
  sottoTransaction: (_database: unknown, operation: (value: typeof mocks.database) => unknown) =>
    operation(mocks.database),
}));
vi.mock('@/lib/sidedoor/storage/core/storage-inputs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sidedoor/storage/core/storage-inputs')>()),
  resolveStorageInput: (...args: unknown[]) => mocks.resolveStorageInput(...args),
  validateStorageInputs: (...args: unknown[]) => mocks.validateStorageInputs(...args),
}));
vi.mock('@/lib/r2', () => ({
  restoreStorageBackend: vi.fn().mockResolvedValue({
    downloadToFile: vi.fn(async (_reference: string, destination: string) => {
      const files = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      await files.mkdir('/tmp/speaking-test', { recursive: true });
      await files.writeFile(destination, Buffer.from('audio'));
      return {};
    }),
  }),
}));
vi.mock('@/lib/sidedoor/jobs/core/job-execution-lifetime', () => ({
  withSottoJobExecution: async (options: {
    validate: (database: typeof mocks.database) => Promise<boolean>;
    run: (context: { directory: string; markCleanupUnconfirmed: () => void }) => Promise<unknown>;
  }) => {
    if (!(await options.validate(mocks.database))) return undefined;
    return options.run({
      directory: '/tmp/speaking-test',
      markCleanupUnconfirmed: mocks.markCleanupUnconfirmed,
    });
  },
}));
vi.mock('@/lib/sidedoor/jobs/core/job-delivery', () => ({
  readSottoWorkerJob: vi.fn().mockResolvedValue({
    complete: false,
    operationId: '10000000-0000-4000-8000-000000000001',
    fingerprint: 'd'.repeat(64),
    scopes: [],
    payload: {
      recordingId: 'recording-1',
      recordingCreatedAt: new Date('2026-01-01T00:00:00Z').getTime(),
      storage: mocks.storageInput,
      ownership: mocks.ownership,
    },
  }),
  sottoJobOutbox: vi.fn(() => ({ complete: vi.fn().mockResolvedValue(true) })),
}));
vi.mock('@/lib/providers/stt', () => ({
  resolveCapturedSttProvider: vi.fn().mockResolvedValue({
    providerId: 'openai',
    apiKey: 'key',
    model: 'whisper-1',
    provider: { transcribe: mocks.transcribe },
  }),
  getConfiguredSttProviderId: vi.fn(() => 'openai'),
}));
vi.mock('@/lib/sidedoor/credentials/runtime/provider-execution', () => ({
  createSottoProviderTransport: vi
    .fn()
    .mockResolvedValue({ authenticatedFetch: mocks.authenticatedFetch }),
}));
vi.mock('@/lib/providers/ai', () => ({
  aiProviderRules: vi.fn(() => [
    { method: 'POST', url: 'https://api.anthropic.com/', descendants: true },
  ]),
}));
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: vi.fn().mockResolvedValue({
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    apiKey: 'ai-key',
    execution: { userId: 'user-1', authorize: vi.fn() },
  }),
}));
vi.mock('@/lib/sidedoor/storage/core/speaking-storage', () => ({
  captureSpeakingRecordingStorage: vi.fn().mockResolvedValue(mocks.ownership),
}));
vi.mock('@/lib/pronunciation/scorer', () => ({
  resolvePronunciationScorer: vi.fn(() => ({ score: mocks.score })),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/server-config', () => ({ infra: vi.fn(() => undefined) }));
vi.mock('@/lib/audio/media-process', () => ({ isMediaCleanupFailure: vi.fn(() => false) }));

import { processSpeakingGrading } from '@/workers/speaking-grading.worker';

function job(): Job<SpeakingGradingPayload> {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    name: 'speaking-grading.v1',
    data: {
      operationId: '10000000-0000-4000-8000-000000000001',
      fingerprint: 'd'.repeat(64),
    },
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<SpeakingGradingPayload>;
}

describe('durable speaking grading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.database.speakingRecording.findUnique.mockResolvedValue(mocks.recording);
    mocks.database.classSection.findUnique.mockResolvedValue({
      class: { course: { targetLang: 'de' } },
    });
    mocks.transcribe.mockImplementation(async (_audio, options) => {
      options.onDispatch();
      options.onSettled();
      return { text: 'Guten Morgen', segments: [], words: [] };
    });
  });

  it('reads attributed storage and publishes only after terminal provider responses', async () => {
    await processSpeakingGrading(job());

    expect(mocks.resolveStorageInput).toHaveBeenCalledWith(
      mocks.database,
      expect.objectContaining({ consumer: 'recording:recording-1:audio' })
    );
    expect(mocks.validateStorageInputs).toHaveBeenCalledWith(mocks.database, [mocks.storageInput]);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SCORED' }) })
    );
    expect(mocks.markCleanupUnconfirmed).not.toHaveBeenCalled();
  });

  it('retains the execution after a dispatch with no terminal proof', async () => {
    mocks.transcribe.mockImplementation(async (_audio, options) => {
      options.onDispatch();
      throw new Error('connection lost');
    });

    await expect(processSpeakingGrading(job())).rejects.toThrow('connection lost');
    expect(mocks.markCleanupUnconfirmed).toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'FAILED' } })
    );
  });
});
