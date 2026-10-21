// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Job } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { setSiteConfig } from '@/lib/site-config';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  resolveSottoRequest,
  requireOriginalSottoAdmission,
} from '@/lib/sidedoor/access/core/request-identity';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { requestPracticePreparation, readPracticePreparation } from '@/lib/practice/preparation';
import { resumePractice } from '@/lib/practice/resume';
import { processPracticePreparation } from '@/workers/practice/practice-preparation.worker';
import { durableEnvelopeSchema } from '@/lib/sidedoor/jobs/core/durable-queue';
import { createSharedTestInstance } from '../../../helpers/setup/shared-instance';
import { practiceProviderFixture, practiceVocabularyFixture } from './provider-fixture';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('Vocabulary work admitted before captured dictionary selections', () => {
  it('validates exact analysis and placement authority on the retained practice import path', () => {
    const base = {
      userId: 'owned-profile',
      createdAt: 1,
      instanceId: randomUUID(),
      scopes: ['instance', 'profile', 'source'].map((subjectId) => ({
        subjectId,
        generation: 1,
      })),
    };
    const authority = {
      ...base,
      kind: 'material-analysis',
      analysisId: randomUUID(),
      sourceSetDigest: 'a'.repeat(64),
    };
    expect(
      durableEnvelopeSchema.parse({
        type: 'material-analysis',
        payload: {},
        authority,
      }).authority
    ).toEqual(authority);
    const placement = {
      ...base,
      kind: 'placement-session',
      placementSessionId: randomUUID(),
      inputDigest: 'b'.repeat(64),
    };
    expect(
      durableEnvelopeSchema.parse({
        type: 'placement-generation',
        payload: {},
        authority: placement,
      }).authority
    ).toEqual(placement);
    expect(() =>
      durableEnvelopeSchema.parse({
        type: 'material-analysis',
        payload: {},
        authority: { ...authority, sourceSetDigest: 'changed' },
      })
    ).toThrow();
  });
  it('publishes a retained null-seed request without changing its specification or fingerprint', async () => {
    const instance = await createSharedTestInstance('retained_vocab');
    const directory = await mkdtemp(join(tmpdir(), 'retained-vocab-'));
    boundary.database = instance.database;
    try {
      vi.stubEnv('BYOK_ENCRYPTION_KEY', '1'.repeat(64));
      vi.stubEnv('SIDEDOOR_EXECUTION_DIR', join(directory, 'executions'));
      const identity = await instance.reset();
      await setSiteConfig(
        {
          aiProvider: 'local',
          aiModel: 'retained-fixture',
          aiBaseUrl: 'http://127.0.0.1:34995/v1',
          ttsProvider: null,
          sttProvider: null,
        },
        identity.ownerId
      );
      await instance.database.user.update({
        where: { id: identity.ownerId },
        data: {
          preferredAiProvider: 'local',
          preferredAiModel: 'local:retained-fixture',
        },
      });
      const curriculum = await instance.database.curriculum.create({
        data: {
          nativeLang: 'en',
          targetLang: 'de',
          title: 'Retained practice fixture',
        },
      });
      const course = await instance.database.course.create({
        data: {
          userId: identity.ownerId,
          nativeLang: 'en',
          targetLang: 'de',
          curriculumId: curriculum.id,
        },
      });
      await instance.database.learnerVocab.create({
        data: {
          courseId: course.id,
          lemma: 'Hallo',
          translation: 'hello',
          mastery: 0.2,
          reps: 1,
          lastReviewed: new Date('2026-01-01'),
          dueAt: new Date('2026-01-01'),
        },
      });
      const request = new Request('http://localhost', {
        headers: { cookie: `sotto_session=${identity.ownerToken}` },
      });
      const original = await sottoTransaction(instance.database, (database) =>
        resolveSottoRequest(database, request)
      );
      if (!original || original.kind !== 'content') throw new Error('Expected learner fixture');
      const execution = {
        userId: original.userId,
        signal: request.signal,
        authorize: async (database: Parameters<typeof requireOriginalSottoAdmission>[0]) => {
          await requireOriginalSottoAdmission(database, request, original);
          return { userId: original.userId };
        },
      };
      const operation = await requestPracticePreparation(course.id, 'VOCAB', execution);
      const admitted = await sottoTransaction(instance.database, (database) =>
        readPracticePreparation(database, operation.sessionId)
      );
      // The previous capture persisted this exact nullable seed shape.
      const {
        schemaVersion,
        practiceLevel,
        learningRequest,
        learningSelection,
        levelCoverage,
        ...legacyGeneration
      } = admitted.generation;
      expect(schemaVersion).toBe(2);
      expect(practiceLevel).toBe('A1');
      expect(learningRequest).toBeNull();
      expect(learningSelection).toBeNull();
      expect(levelCoverage).toBeDefined();
      const generation = { ...legacyGeneration, seed: null };
      const {
        generationVersion,
        practiceLevel: operationLevel,
        learningRequest: operationRequest,
        ...legacyOperation
      } = operation;
      expect(generationVersion).toBe(2);
      expect(operationLevel).toBe('A1');
      expect(operationRequest).toBeNull();
      const fingerprint = createHash('sha256').update(JSON.stringify(generation)).digest('hex');
      await instance.database.practiceSession.update({
        where: { id: operation.sessionId },
        data: {
          practiceLevel: null,
          learningSelection: Prisma.JsonNull,
          generationSpec: generation,
          generationState: {
            ...legacyOperation,
            inputFingerprint: fingerprint,
          },
        },
      });
      const record = await sottoTransaction(instance.database, (database) =>
        sottoJobOutbox(database).read(operation.id)
      );
      if (!record) throw new Error('Missing retained outbox fixture');
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        const payload = JSON.parse(await request.text()) as {
          messages: { role: string; content: string }[];
          response_format?: { json_schema?: { name?: string } };
        };
        const name = payload.response_format?.json_schema?.name;
        const inputText = payload.messages.at(-1)?.content ?? '';
        let reviewed: {
          items?: { index: number }[];
          questions?: { index: number }[];
        } = {};
        try {
          reviewed = JSON.parse(inputText);
        } catch {
          /* Initial generation is plain text. */
        }
        const content =
          name === 'class_teaching_critic'
            ? {
                items: reviewed.items!.map(({ index }) => ({
                  index,
                  findings: [],
                })),
              }
            : name === 'class_teaching_adjudicator'
              ? {
                  items: reviewed.items!.map(({ index }) => ({
                    index,
                    newFindings: [],
                    criticDecisions: [],
                  })),
                }
              : reviewed.items
                ? {
                    items: reviewed.items.map(({ index }) => ({
                      index,
                      acceptable: true,
                      issues: [],
                      feedback: [],
                    })),
                  }
                : reviewed.questions
                  ? {
                      passageFindings: [],
                      issues: [],
                      questions: reviewed.questions.map(({ index }) => ({
                        index,
                        acceptableOptionIndices: [0],
                        issues: [],
                      })),
                    }
                  : practiceVocabularyFixture(inputText);
        return Response.json(
          practiceProviderFixture(content, inputText, {
            jsonSchema: payload.response_format?.json_schema,
          })
        );
      });
      const job = {
        id: operation.id,
        name: 'practice-preparation.v1',
        data: { operationId: operation.id, fingerprint: record.fingerprint },
      } as Job<unknown>;
      await processPracticePreparation(job);
      await processPracticePreparation(job);
      const completed = await sottoTransaction(instance.database, (database) =>
        readPracticePreparation(database, operation.sessionId)
      );
      expect(completed.operation.status).toBe('COMPLETED');
      expect(completed.session.status).toBe('ACTIVE');
      expect(completed.session.vocabLemmas).toEqual(['Hallo']);
      expect(completed.session.generationSpec).toEqual(generation);
      expect(completed.operation.inputFingerprint).toBe(fingerprint);
      expect(await resumePractice(operation.sessionId, identity.ownerId)).toMatchObject({
        status: 'ready',
        sessionId: operation.sessionId,
      });
      await sottoTransaction(instance.database, async (database) => {
        expect((await sottoJobOutbox(database).read(operation.id))?.complete).toBe(true);
        await sottoJobExecutions(database).requireParentDrained(operation.id, record.fingerprint);
      });
    } finally {
      boundary.database = null;
      await instance.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
