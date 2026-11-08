import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createSkillRequirements } from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import type { AssessmentFence } from '@/lib/learning/classes/lifecycle/assessment-fence';
import { assessmentMaterialDigest } from '@/lib/learning/classes/material/assessment-material';
import { encodeAssessmentHistory } from '@/lib/learning/classes/history/assessment-history-codec';
import { readAssessmentHistory } from '@/lib/learning/classes/history/assessment-history';
import { sampleTeaching } from '../../../../helpers/learning/class-teaching';

const boundary = vi.hoisted(() => ({ readPage: vi.fn(), readProjection: vi.fn() }));
vi.mock('@/lib/sidedoor/jobs/core/job-delivery', () => ({
  sottoJobSnapshot: () => ({ read: boundary.readPage }),
}));
vi.mock('@/lib/learning/classes/history/assessment-prior-projection', () => ({
  readPriorAssessmentProjection: boundary.readProjection,
}));

describe('historical assessment predecessor binding', () => {
  it('requires every previous task in order and enforces one combined history budget', async () => {
    const requirements = createSkillRequirements({
      scope: 'CLASS',
      nativeLang: 'es',
      targetLang: 'ru',
      level: 'A1',
      ttsProvider: null,
      sttProvider: null,
    });
    const material = {
      version: 1,
      id: 'current',
      classId: 'class',
      courseId: 'course',
      userId: 'owner',
      classAttempt: 1,
      assessmentAttempt: 3,
      formativeRevision: 'revision',
      requirements,
      sections: [],
    };
    const previous = [1, 2].map((attempt) => ({
      assessmentId: `assessment-${attempt}`,
      classAttempt: 1,
      assessmentAttempt: attempt,
      submissionId: `submission-${attempt}`,
      requestDigest: 'a'.repeat(64),
      operationId: randomUUID(),
      fingerprint: 'b'.repeat(64),
      tasks: [{ id: `task-${attempt}`, skill: 'WRITING', task: `Question ${attempt}` }],
    }));
    const rows = previous.map((item) => ({
      id: item.assessmentId,
      classAttempt: item.classAttempt,
      assessmentAttempt: item.assessmentAttempt,
      classId: 'class',
      courseId: 'course',
      userId: 'owner',
      status: 'COMMITTED',
      generationOperationId: item.operationId,
      submission: { id: item.submissionId, requestDigest: item.requestDigest },
    }));
    const database = {
      $queryRaw: vi.fn(),
      classAssessment: { findMany: vi.fn().mockResolvedValue(rows) },
    } as unknown as Prisma.TransactionClient;
    const fence = {
      assessmentId: 'current',
      classId: 'class',
      courseId: 'course',
      userId: 'owner',
      classAttempt: 1,
      assessmentAttempt: 3,
      formativeRevision: 'revision',
      requirements,
      thresholds: {},
    } as AssessmentFence;
    const history = {
      material,
      formativeIds: previous.map((item) => item.tasks[0]!.id),
      formativeTasks: previous.map((item) => ({ skill: 'WRITING', task: item.tasks[0]!.task })),
      passThresholds: {},
      priorAssessments: previous,
    };
    boundary.readProjection.mockImplementation(
      async (...args: [unknown, { assessmentId: string }, number]) => {
        if (args[2] < 20) throw new Error('History too large');
        return {
          tasks: previous.find((item) => item.assessmentId === args[1].assessmentId)!.tasks,
          bytes: 20,
        };
      }
    );
    const read = (value: unknown) => {
      const saved = encodeAssessmentHistory(value);
      boundary.readPage.mockResolvedValue({ pages: 2, next: null, items: [saved.chunks[0]] });
      return readAssessmentHistory(database, {
        id: randomUUID(),
        fingerprint: 'c'.repeat(64),
        manifest: saved.manifest,
        fence,
        materialDigest: assessmentMaterialDigest(material),
      });
    };
    await expect(read(history)).resolves.toMatchObject({ priorAssessments: previous });
    await expect(read({ ...history, priorAssessments: [...previous].reverse() })).rejects.toThrow();
    const changed = structuredClone(history);
    changed.priorAssessments[1]!.tasks[0]!.task = 'Changed task';
    changed.formativeTasks[1]!.task = 'Changed task';
    await expect(read(changed)).rejects.toThrow();
    vi.mocked(database.classAssessment.findMany).mockResolvedValueOnce([rows[1]] as never);
    await expect(
      read({
        ...history,
        priorAssessments: [previous[1]],
        formativeIds: [previous[1]!.tasks[0]!.id],
        formativeTasks: [{ skill: 'WRITING', task: previous[1]!.tasks[0]!.task }],
      })
    ).rejects.toThrow();
    fence.classAttempt = 2;
    fence.assessmentAttempt = 1;
    material.classAttempt = 2;
    material.assessmentAttempt = 1;
    await expect(read(history)).resolves.toMatchObject({ priorAssessments: previous });
    vi.mocked(database.classAssessment.findMany).mockResolvedValueOnce([rows[1]] as never);
    await expect(
      read({
        ...history,
        material,
        priorAssessments: [previous[1]],
        formativeIds: [previous[1]!.tasks[0]!.id],
        formativeTasks: [{ skill: 'WRITING', task: previous[1]!.tasks[0]!.task }],
      })
    ).rejects.toThrow();
    fence.classAttempt = 1;
    fence.assessmentAttempt = 3;
    material.classAttempt = 1;
    material.assessmentAttempt = 3;
    boundary.readProjection.mockImplementationOnce(async () => ({
      tasks: previous[0]!.tasks,
      bytes: 32 * 1024 * 1024,
    }));
    await expect(read(history)).rejects.toThrow('History too large');
  });

  it('rejects missing, changed or unbound prior work', async () => {
    const requirements = createSkillRequirements({
      scope: 'CLASS',
      nativeLang: 'es',
      targetLang: 'ru',
      level: 'A1',
      ttsProvider: null,
      sttProvider: null,
    });
    const material = {
      version: 1,
      id: 'current',
      classId: 'class',
      courseId: 'course',
      userId: 'owner',
      classAttempt: 1,
      assessmentAttempt: 2,
      formativeRevision: 'revision',
      requirements,
      sections: [],
    };
    const operationId = randomUUID();
    const fingerprint = 'a'.repeat(64);
    const requestDigest = 'b'.repeat(64);
    const prior = {
      assessmentId: 'previous',
      classAttempt: 1,
      assessmentAttempt: 1,
      submissionId: 'submission',
      requestDigest,
      operationId,
      fingerprint,
      tasks: [{ id: 'old-question', skill: 'GRAMMAR', task: 'Pide agua' }],
    };
    const history = {
      scoringPolicy: 1,
      material,
      formativeIds: ['old-question'],
      formativeTasks: [{ skill: 'GRAMMAR', task: 'Pide agua' }],
      passThresholds: {},
      priorAssessments: [prior],
      reviewSource: {
        lesson: {
          course: { nativeLang: 'es', targetLang: 'ru' },
          lesson: { level: 'A1', title: 'Primeras palabras', objective: 'Pedir una bebida' },
          teaching: {
            ...sampleTeaching,
            guidedPractice: { prompt: 'Pide té.', hint: 'Usa una expresión cortés.' },
          },
          sections: [
            {
              id: 'grammar',
              skill: 'GRAMMAR',
              attempt: 1,
              status: 'READY',
              questions: [],
              speaking: [],
              writing: [],
              listening: null,
            },
          ],
        },
        prerequisite: null,
      },
    };
    const row = {
      id: 'previous',
      classAttempt: 1,
      assessmentAttempt: 1,
      classId: 'class',
      courseId: 'course',
      userId: 'owner',
      status: 'COMMITTED',
      generationOperationId: operationId,
      submission: { id: 'submission', requestDigest },
    };
    const database = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      classAssessment: { findMany: vi.fn().mockResolvedValue([row]) },
    } as unknown as Prisma.TransactionClient;
    const fence = {
      assessmentId: 'current',
      classId: 'class',
      courseId: 'course',
      userId: 'owner',
      classAttempt: 1,
      assessmentAttempt: 2,
      formativeRevision: 'revision',
      requirements,
      thresholds: {},
    } as AssessmentFence;
    boundary.readProjection.mockResolvedValue({ tasks: prior.tasks, bytes: 10 });
    const read = (value: unknown) => {
      const saved = encodeAssessmentHistory(value);
      boundary.readPage.mockResolvedValue({ pages: 2, next: null, items: [saved.chunks[0]] });
      return readAssessmentHistory(database, {
        id: randomUUID(),
        fingerprint,
        manifest: saved.manifest,
        fence,
        materialDigest: assessmentMaterialDigest(material),
      });
    };
    await expect(read(history)).resolves.toMatchObject({ priorAssessments: [prior] });
    await expect(read(history)).resolves.toMatchObject({ reviewSource: history.reviewSource });
    const legacy = Object.fromEntries(
      Object.entries(history).filter(([key]) => key !== 'reviewSource')
    );
    await expect(read(legacy)).resolves.toMatchObject({ priorAssessments: [prior] });
    await expect(
      read({
        ...history,
        reviewSource: {
          ...history.reviewSource,
          lesson: {
            ...history.reviewSource.lesson,
            course: { nativeLang: 'en', targetLang: 'ru' },
          },
        },
      })
    ).rejects.toThrow();
    await expect(read({ ...history, priorAssessments: [] })).rejects.toThrow();
    await expect(
      read({ ...history, priorAssessments: [{ ...prior, requestDigest: 'c'.repeat(64) }] })
    ).rejects.toThrow();
    await expect(
      read({ ...history, formativeTasks: [{ skill: 'GRAMMAR', task: 'Changed task' }] })
    ).rejects.toThrow();
    boundary.readProjection.mockResolvedValue({ tasks: [], bytes: 10 });
    await expect(read(history)).rejects.toThrow();
    boundary.readProjection.mockResolvedValue({ tasks: prior.tasks, bytes: 10 });
    boundary.readProjection.mockRejectedValue(new Error('Changed predecessor'));
    await expect(read(history)).rejects.toThrow();
  });
});
