import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { delegationBindingSchema } from 'thesidedoor-core/runtime/delegation';
import {
  pencilHomeworkProposalSchema,
  pencilHomeworkRequestSchema,
  type PencilHomeworkRequest,
} from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import { currentClassSections } from '@/lib/learning/classes/current-sections';
import { captureCourseStorage } from '@/lib/sidedoor/storage/core/course-storage';
import { sottoJobSnapshot } from '@/lib/sidedoor/jobs/core/job-delivery';
import type { PencilTask } from './homework-vision';

export class PencilHomeworkError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 422
  ) {
    super(message);
  }
}

export const pencilHomeworkWorkSchema = pencilHomeworkRequestSchema
  .extend({
    classId: z.string().min(1),
    courseId: z.string().min(1),
    grant: delegationBindingSchema,
    userId: z.string().min(1),
    task: z
      .object({
        kind: z.enum(['QUESTION', 'WRITING']),
        id: z.string(),
        prompt: z.string(),
        options: z.array(z.string()),
        passage: z.string().nullable(),
        nativeLang: z.string(),
        targetLang: z.string(),
        level: z.string(),
      })
      .strict(),
    selection: z
      .object({
        provider: z.string(),
        model: z.string(),
        endpoint: z.string().optional(),
        credentialFingerprint: z.string().nullable(),
        moderationCredentialFingerprint: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

export async function readPencilTask(
  database: Prisma.TransactionClient,
  classId: string,
  userId: string,
  request: Pick<PencilHomeworkRequest, 'attempt' | 'taskKind' | 'taskId'>
) {
  const cls = await database.courseClass.findFirst({
    where: { id: classId, course: { userId } },
    include: {
      course: true,
      lesson: true,
      sections: { include: { questions: true, writingPrompts: true } },
    },
  });
  if (!cls) throw new PencilHomeworkError('Class not found', 404);
  if (cls.attempt !== request.attempt)
    throw new PencilHomeworkError(
      'This workbook belongs to an earlier class attempt. Reopen the class.',
      409
    );
  const sections = currentClassSections(cls.sections);
  const question = sections
    .flatMap((section) => section.questions)
    .find((item) => item.id === request.taskId);
  const writing = sections
    .flatMap((section) => section.writingPrompts)
    .find((item) => item.id === request.taskId);
  const prompt = request.taskKind === 'QUESTION' ? question?.question : writing?.task;
  if (!prompt) throw new PencilHomeworkError('This exercise is no longer part of the class.', 409);
  const task: PencilTask = {
    kind: request.taskKind,
    id: request.taskId,
    prompt,
    options: request.taskKind === 'QUESTION' ? z.array(z.string()).parse(question!.options) : [],
    passage: request.taskKind === 'QUESTION' ? question!.passageText : writing!.guidance,
    nativeLang: cls.course.nativeLang,
    targetLang: cls.course.targetLang,
    level: cls.lesson.level,
  };
  const ownership = await captureCourseStorage(database, cls.courseId);
  return { task, ownership, courseId: cls.courseId };
}

export async function requirePencilWork(
  database: Prisma.TransactionClient,
  classId: string,
  work: z.infer<typeof pencilHomeworkWorkSchema>,
  scopes: readonly { subjectId: string; generation: number }[]
) {
  const current = await readPencilTask(database, classId, work.userId, work);
  if (
    !isDeepStrictEqual(current.task, work.task) ||
    !isDeepStrictEqual(current.ownership.scopes, scopes)
  )
    throw new PencilHomeworkError(
      'The class exercise or learner ownership changed. Reopen the workbook.',
      409
    );
  return current;
}

export const pencilOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('READY'), proposal: pencilHomeworkProposalSchema }).strict(),
  z.object({ status: z.literal('FAILED'), error: z.string().min(1) }).strict(),
]);

export async function retainPencilOutcome(
  database: Prisma.TransactionClient,
  id: string,
  fingerprint: string,
  outcome: z.infer<typeof pencilOutcomeSchema>
) {
  const snapshot = sottoJobSnapshot(database);
  await snapshot.createForJob({ id, fingerprint });
  await snapshot.append(id, fingerprint, 0, [outcome]);
  await snapshot.seal(id, fingerprint);
}

export async function readPencilOutcome(
  database: Prisma.TransactionClient,
  id: string,
  fingerprint: string
) {
  let page;
  try {
    page = await sottoJobSnapshot(database).read(id, fingerprint, 0);
  } catch (error) {
    if (error instanceof Error && error.message === 'Snapshot is missing') return null;
    throw error;
  }
  if (page.pages !== 1 || page.next !== null || page.items.length !== 1)
    throw new Error('The retained homework result is incomplete.');
  return pencilOutcomeSchema.parse(page.items[0]);
}
