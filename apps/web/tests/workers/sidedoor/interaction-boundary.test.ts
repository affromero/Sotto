// @vitest-environment node
import { randomUUID } from 'node:crypto';
import type { Job } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  bindDurableQueueJob,
  enqueueDurableQueueJob,
  loadDurableQueueJob,
} from '@/lib/sidedoor/jobs/core/durable-queue';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { processInteraction } from '@/workers/interaction.worker';
import type { ProcessInteractionPayload } from '@/lib/queue';
import { ContentModerationError } from '@/lib/moderation';
import {
  createSharedTestInstance,
  type SharedTestIdentity,
  type SharedTestInstance,
} from '../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({
  database: null as PrismaClient | null,
  generate: vi.fn(),
  usage: vi.fn(),
  loseCommitResponse: false,
  useRealTransport: false,
}));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedEpisodeAi: async ({ execution }: { execution: unknown }) => ({
    provider: 'fixture',
    model: 'fixture',
    execution,
  }),
  capturedLearningAiOptions: async (ai: {
    execution: import('@/lib/sidedoor/credentials/runtime/provider-execution').SottoProviderExecution;
  }) => {
    if (!boundary.useRealTransport) return { model: 'fixture' };
    const { createSottoProviderTransport } =
      await import('@/lib/sidedoor/credentials/runtime/provider-execution');
    const transport = await createSottoProviderTransport(ai.execution, [
      { url: 'https://provider.example/respond', method: 'POST' },
    ]);
    return { model: 'fixture', fetch: transport.authenticatedFetch };
  },
}));
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({ generateResponse: boundary.generate }),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: boundary.usage }));
vi.mock('@/lib/sidedoor/access/state/write-transaction', async (original) => {
  const actual = await original<typeof import('@/lib/sidedoor/access/state/write-transaction')>();
  return {
    ...actual,
    sottoStateWriteTransaction: async (
      ...args: Parameters<typeof actual.sottoStateWriteTransaction>
    ) => {
      const result = await actual.sottoStateWriteTransaction(...args);
      if (boundary.loseCommitResponse) {
        boundary.loseCommitResponse = false;
        throw new Error('Lost committed response');
      }
      return result;
    },
  };
});

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('durable interaction assessment boundary', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('interaction_boundary');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    identity = await instance.reset();
    boundary.generate.mockReset();
    boundary.loseCommitResponse = false;
    boundary.useRealTransport = false;
    boundary.generate.mockResolvedValue({
      content: 'Answer',
      inputTokens: 1,
      outputTokens: 1,
      model: 'fixture',
    });
    boundary.usage.mockReset();
    boundary.usage.mockResolvedValue(undefined);
  });
  afterAll(async () => {
    boundary.database = null;
    await instance?.close();
  });

  async function work(attachBeforeAdmission = false) {
    const episode = attachBeforeAdmission
      ? await attach()
      : await instance.database.episode.create({
          data: { userId: identity.ownerId, title: 'Episode', topic: 'Topic' },
        });
    await instance.database.script.create({
      data: {
        episodeId: episode.id,
        markdown: 'HOST: Hello',
        turns: [{ speaker: 'HOST', text: 'Hello' }],
      },
    });
    const payload: ProcessInteractionPayload = {
      episodeId: episode.id,
      interactionId: randomUUID(),
      userId: identity.ownerId,
      question: 'What was said?',
      timestamp: 1,
    };
    const record = await sottoTransaction(instance.database, async (tx) => {
      await tx.interaction.create({
        data: {
          id: payload.interactionId,
          episodeId: episode.id,
          userId: identity.ownerId,
          question: payload.question,
          timestamp: payload.timestamp,
        },
      });
      return enqueueDurableQueueJob(tx, {
        handler: 'interactions',
        type: 'process_interaction',
        payload,
        jobId: `test-${randomUUID()}`,
      });
    });
    const queued = {
      id: record.job.id,
      name: 'interactions.v1',
      data: { operationId: record.job.id, fingerprint: record.fingerprint },
      updateProgress: async () => {},
    } as unknown as Job<unknown>;
    const loaded = await sottoTransaction(instance.database, (tx) =>
      loadDurableQueueJob<ProcessInteractionPayload>(tx, queued, 'interactions', 1)
    );
    if (loaded.complete) throw new Error('Fixture job already complete');
    return { episode, payload, record, queued, job: bindDurableQueueJob(queued, payload, loaded) };
  }

  async function attach(episodeId?: string) {
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'es', targetLang: 'ru' } },
      create: { nativeLang: 'es', targetLang: 'ru', title: 'Russian' },
      update: {},
    });
    const lesson = await instance.database.lesson.upsert({
      where: { curriculumId_slug: { curriculumId: curriculum.id, slug: 'interaction-assessment' } },
      create: {
        curriculumId: curriculum.id,
        slug: 'interaction-assessment',
        level: 'A1',
        order: 1,
        title: 'Lesson',
        objective: 'Greet',
        grammarPoints: [],
        targetVocab: [],
        vocabThemes: [],
      },
      update: {},
    });
    const course = await instance.database.course.create({
      data: {
        userId: identity.ownerId,
        curriculumId: curriculum.id,
        nativeLang: 'es',
        targetLang: 'ru',
      },
    });
    const cls = await instance.database.courseClass.create({
      data: { courseId: course.id, lessonId: lesson.id, order: 1 },
    });
    const assessment = await instance.database.classAssessment.create({
      data: {
        classId: cls.id,
        courseId: course.id,
        userId: identity.ownerId,
        classAttempt: 1,
        assessmentAttempt: 1,
        requirements: {},
        formativeRevision: 'revision',
        generationOperationId: randomUUID(),
      },
    });
    if (episodeId) {
      await instance.database.classAssessmentSection.create({
        data: { assessmentId: assessment.id, skill: 'LISTENING', passThreshold: 0.7, episodeId },
      });
      throw new Error('An existing episode must not become assessment audio');
    }
    const section = await instance.database.classAssessmentSection.create({
      data: { assessmentId: assessment.id, skill: 'LISTENING', passThreshold: 0.7 },
    });
    return sottoTransaction(instance.database, async (tx) => {
      const episode = await tx.episode.create({
        data: {
          userId: identity.ownerId,
          title: 'Episode',
          topic: 'Topic',
          assessmentAudioAssessmentId: assessment.id,
          assessmentAudioSectionId: section.id,
          assessmentAudioOperationId: assessment.generationOperationId,
        },
      });
      await tx.classAssessmentSection.update({
        where: { id: section.id },
        data: {
          episodeId: episode.id,
          audioReservationEpisodeId: episode.id,
          audioReservationOperationId: assessment.generationOperationId,
        },
      });
      return episode;
    });
  }

  it('retains the answer and completed receipt if logging fails after publication', async () => {
    const item = await work();
    boundary.usage.mockRejectedValue(new Error('usage logging failed'));
    await expect(processInteraction(item.job)).rejects.toThrow('usage logging failed');
    expect(
      await instance.database.interaction.findUniqueOrThrow({
        where: { id: item.payload.interactionId },
      })
    ).toMatchObject({ status: 'ANSWERED', answer: 'Answer' });
    const receipt = await sottoTransaction(instance.database, (tx) =>
      sottoJobOutbox(tx).receipt(item.record.job.id)
    );
    expect(receipt?.status).toBe('complete');
    const replay = await sottoTransaction(instance.database, (tx) =>
      loadDurableQueueJob<ProcessInteractionPayload>(tx, item.queued, 'interactions', 1)
    );
    expect(replay.complete).toBe(true);
    expect(boundary.generate).toHaveBeenCalledTimes(1);
  });

  it('rolls back job completion when the answer cannot be saved', async () => {
    const item = await work();
    await instance.database.$executeRawUnsafe(
      'ALTER TABLE "Interaction" ADD CONSTRAINT "test_reject_answer" CHECK (answer IS NULL)'
    );
    try {
      await expect(processInteraction(item.job)).rejects.toThrow();
      expect(
        await instance.database.interaction.findUniqueOrThrow({
          where: { id: item.payload.interactionId },
        })
      ).toMatchObject({ status: 'PENDING', answer: null });
      const receipt = await sottoTransaction(instance.database, (tx) =>
        sottoJobOutbox(tx).receipt(item.record.job.id)
      );
      expect(receipt?.status).toBe('pending');
    } finally {
      await instance.database.$executeRawUnsafe(
        'ALTER TABLE "Interaction" DROP CONSTRAINT "test_reject_answer"'
      );
    }
  });

  it('rejects converting an existing episode while a provider answer is generated', async () => {
    const item = await work();
    boundary.generate.mockImplementation(async () => {
      await attach(item.episode.id);
      return { content: 'PRIVATE_ANSWER', inputTokens: 1, outputTokens: 1, model: 'fixture' };
    });
    await expect(processInteraction(item.job)).rejects.toThrow(
      'Assessment audio must match its creation reservation'
    );
    expect(
      await instance.database.interaction.findUniqueOrThrow({
        where: { id: item.payload.interactionId },
      })
    ).toMatchObject({ status: 'PENDING', answer: null });
    const receipt = await sottoTransaction(instance.database, (tx) =>
      sottoJobOutbox(tx).receipt(item.record.job.id)
    );
    expect(receipt?.status).toBe('pending');
  });

  it('does not dispatch an interaction captured on an assessment episode', async () => {
    const item = await work(true);
    await expect(processInteraction(item.job)).rejects.toThrow('Episode not found');
    expect(boundary.generate).not.toHaveBeenCalled();
    expect(
      await instance.database.interaction.findUniqueOrThrow({
        where: { id: item.payload.interactionId },
      })
    ).toMatchObject({ status: 'PENDING', answer: null });
  });

  it('rejects an assessment delivery without its durable job', async () => {
    const id = randomUUID();
    const job = {
      id,
      name: 'interactions.v6',
      data: { operationId: id, fingerprint: 'a'.repeat(64) },
    } as unknown as Job<ProcessInteractionPayload>;
    await expect(processInteraction(job)).rejects.toThrow();
    expect(boundary.generate).not.toHaveBeenCalled();
  });

  it('rejects converting an existing episode before provider transport dispatch', async () => {
    const item = await work();
    boundary.useRealTransport = true;
    const network = vi.spyOn(globalThis, 'fetch');
    try {
      boundary.generate.mockImplementation(
        async (...args: [unknown, unknown, { fetch: typeof fetch }]) => {
          await attach(item.episode.id);
          await args[2].fetch('https://provider.example/respond', {
            method: 'POST',
            body: 'question',
          });
          return { content: 'PRIVATE_ANSWER', inputTokens: 1, outputTokens: 1, model: 'fixture' };
        }
      );
      await expect(processInteraction(item.job)).rejects.toThrow(
        'Assessment audio must match its creation reservation'
      );
      expect(network).not.toHaveBeenCalled();
      expect(
        await instance.database.interaction.findUniqueOrThrow({
          where: { id: item.payload.interactionId },
        })
      ).toMatchObject({ status: 'PENDING', answer: null });
    } finally {
      network.mockRestore();
    }
  });

  it('retains a moderation result and completed receipt after a lost commit response', async () => {
    const item = await work();
    boundary.generate.mockRejectedValue(new ContentModerationError(['safety']));
    boundary.loseCommitResponse = true;
    await expect(processInteraction(item.job)).rejects.toThrow('Lost committed response');
    expect(
      await instance.database.interaction.findUniqueOrThrow({
        where: { id: item.payload.interactionId },
      })
    ).toMatchObject({ status: 'ANSWERED', answer: 'Unable to answer — content policy violation.' });
    const replay = await sottoTransaction(instance.database, (tx) =>
      loadDurableQueueJob<ProcessInteractionPayload>(tx, item.queued, 'interactions', 1)
    );
    expect(replay.complete).toBe(true);
    expect(boundary.generate).toHaveBeenCalledTimes(1);
  });
});
