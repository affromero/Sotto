// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createSkillRequirements } from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import { assessmentMaterialDigest } from '@/lib/learning/classes/material/assessment-material';
import { encodeAssessmentHistory } from '@/lib/learning/classes/history/assessment-history-codec';
import { readPriorAssessmentProjection } from '@/lib/learning/classes/history/assessment-prior-projection';

const boundary = vi.hoisted(() => ({ operation: vi.fn(), page: vi.fn(), archive: vi.fn() }));
vi.mock('@/lib/sidedoor/jobs/core/job-delivery', () => ({
  sottoJobOutbox: () => ({ read: boundary.operation }),
  sottoJobSnapshot: () => ({ read: boundary.page }),
}));
vi.mock('@/lib/learning/classes/history/assessment-archive', () => ({
  readAssessmentArchive: boundary.archive,
}));

describe('prior assessment projection', () => {
  it('reads only the sealed predecessor and rejects a changed snapshot or exhausted budget', async () => {
    const operationId = randomUUID();
    const instanceId = randomUUID();
    const fingerprint = 'a'.repeat(64);
    const requirements = createSkillRequirements({
      scope: 'CLASS',
      nativeLang: 'es',
      targetLang: 'ru',
      level: 'A1',
      ttsProvider: null,
      sttProvider: null,
    });
    const fence = {
      id: operationId,
      assessmentId: 'assessment',
      classId: 'class',
      courseId: 'course',
      userId: 'learner',
      classAttempt: 1,
      assessmentAttempt: 1,
      formativeRevision: 'b'.repeat(64),
      ownership: {
        instanceId,
        userId: 'learner',
        scopes: [
          { subjectId: `instance:${instanceId}`, generation: 0 },
          { subjectId: 'profile:learner', generation: 1 },
          { subjectId: 'course:course', generation: 1 },
          { subjectId: 'class:class', generation: 1 },
        ],
      },
      teachingReceipt: { kind: 'BASE', receiptId: 'receipt' },
      requirements,
      thresholds: { GRAMMAR: 0.7, READING: 0.7, WRITING: 0.7 },
      selection: {
        provider: 'openai',
        model: 'fixture',
        credentialFingerprint: null,
        moderationCredentialFingerprint: null,
      },
      cliBinding: null,
      grant: { id: operationId, revision: randomUUID(), fingerprint: 'c'.repeat(64) },
      status: 'QUEUED',
    };
    const material = {
      version: 1,
      id: 'assessment',
      classId: 'class',
      courseId: 'course',
      userId: 'learner',
      classAttempt: 1,
      assessmentAttempt: 1,
      formativeRevision: fence.formativeRevision,
      requirements,
      sections: [
        {
          id: 'reading',
          skill: 'READING',
          passThreshold: 0.7,
          passageText: 'Вода в кафе.',
          audio: null,
          items: [
            {
              id: 'reading-task',
              question: '¿Qué hay?',
              options: ['agua', 'té', 'café', 'leche'],
              correctIndex: 0,
              explanation: 'Agua.',
            },
          ],
        },
        {
          id: 'listening',
          skill: 'LISTENING',
          passThreshold: 0.7,
          passageText: null,
          audio: {
            episodeId: 'episode',
            mediaIdentity: 'audio',
            privateTranscript: 'Чай, пожалуйста.',
          },
          items: [
            {
              id: 'listening-task',
              question: '¿Qué pide?',
              options: ['té', 'agua', 'café', 'leche'],
              correctIndex: 0,
              explanation: 'Té.',
            },
          ],
        },
        {
          id: 'speaking',
          skill: 'SPEAKING',
          passThreshold: 0.7,
          items: [
            {
              id: 'speaking-task',
              task: 'Вода, пожалуйста.',
              mode: 'READ_ALOUD',
              referenceAudioId: null,
              privateRubric: 'Rubric',
              privateGuidance: '',
              privateTranslation: '',
              privateIpa: null,
              privateLearningObjectives: null,
            },
          ],
        },
        {
          id: 'writing',
          skill: 'WRITING',
          passThreshold: 0.7,
          items: [
            {
              id: 'task',
              task: 'Pide agua',
              privateRubric: 'Rubric',
              privateGuidance: null,
              privateIdeas: [],
              privateLearningObjectives: null,
            },
          ],
        },
      ],
    };
    const history = encodeAssessmentHistory({ material });
    const outcome = {
      status: 'READY',
      operationId,
      fingerprint,
      assessmentId: 'assessment',
      classId: 'class',
      userId: 'learner',
      classAttempt: 1,
      assessmentAttempt: 1,
      formativeRevision: fence.formativeRevision,
      teachingKind: 'BASE',
      teachingReceiptId: 'receipt',
      materialDigest: assessmentMaterialDigest(material),
      reviewOperationId: 'review',
      reviewReceiptDigest: 'd'.repeat(64),
      history: history.manifest,
    };
    boundary.operation.mockResolvedValue({
      complete: true,
      fingerprint,
      job: {
        id: operationId,
        handler: 'interactions',
        version: 6,
        payload: { kind: 'CLASS_ASSESSMENT', fence },
        scopes: fence.ownership.scopes,
      },
    });
    boundary.archive.mockResolvedValue({
      fingerprint,
      historyDigest: history.manifest.digest,
      fence: { ...fence, status: 'COMPLETED' },
    });
    boundary.page.mockImplementation(async (...args: [string, string, number]) =>
      args[2] === 0
        ? { pages: 2, next: 1, items: [outcome] }
        : { pages: 2, next: null, items: [history.chunks[0]] }
    );
    const input = {
      operationId,
      fingerprint,
      assessmentId: 'assessment',
      classId: 'class',
      courseId: 'course',
      userId: 'learner',
      classAttempt: 1,
      assessmentAttempt: 1,
    };
    const database = {} as Prisma.TransactionClient;
    await expect(
      readPriorAssessmentProjection(database, input, history.manifest.bytes)
    ).resolves.toEqual({
      tasks: [
        {
          id: 'reading-task',
          skill: 'READING',
          task: '¿Qué hay?',
          options: ['agua', 'té', 'café', 'leche'],
          context: 'Вода в кафе.',
        },
        {
          id: 'listening-task',
          skill: 'LISTENING',
          task: '¿Qué pide?',
          options: ['té', 'agua', 'café', 'leche'],
          context: 'Чай, пожалуйста.',
        },
        { id: 'speaking-task', skill: 'SPEAKING', task: 'Вода, пожалуйста.', mode: 'READ_ALOUD' },
        { id: 'task', skill: 'WRITING', task: 'Pide agua' },
      ],
      bytes: history.manifest.bytes,
    });
    await expect(
      readPriorAssessmentProjection(database, input, history.manifest.bytes - 1)
    ).rejects.toThrow();
    await expect(
      readPriorAssessmentProjection(
        database,
        { ...input, classId: 'other' },
        history.manifest.bytes
      )
    ).rejects.toThrow();
    boundary.page.mockResolvedValueOnce({
      pages: 2,
      next: 1,
      items: [{ ...outcome, materialDigest: 'f'.repeat(64) }],
    });
    await expect(
      readPriorAssessmentProjection(database, input, history.manifest.bytes)
    ).rejects.toThrow();
    boundary.page.mockResolvedValueOnce({ pages: 2, next: null, items: [outcome] });
    await expect(
      readPriorAssessmentProjection(database, input, history.manifest.bytes)
    ).rejects.toThrow();
    boundary.operation.mockResolvedValueOnce({
      complete: true,
      fingerprint,
      job: {
        id: operationId,
        handler: 'interactions',
        version: 6,
        payload: { kind: 'CLASS_ASSESSMENT', fence },
        scopes: [],
      },
    });
    await expect(
      readPriorAssessmentProjection(database, input, history.manifest.bytes)
    ).rejects.toThrow();
    boundary.archive.mockResolvedValue({
      fingerprint,
      historyDigest: 'e'.repeat(64),
      fence: { ...fence, status: 'COMPLETED' },
    });
    await expect(
      readPriorAssessmentProjection(database, input, history.manifest.bytes)
    ).rejects.toThrow();
  });
});
