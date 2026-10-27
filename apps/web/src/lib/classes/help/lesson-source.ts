import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { classTeachingSchema } from '@sotto/shared';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { captureCourseStorage } from '@/lib/sidedoor/storage/core/course-storage';
import { teachingFromSeed } from '@/lib/classes/lesson/teaching';
import { durableQueueOperationId } from '@/lib/sidedoor/jobs/core/durable-queue';

export class ClassLessonHelpError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 422
  ) {
    super(message);
  }
}

export const lessonHelpSourceSchema = classTeachingSchema.omit({ guidedPractice: true }).extend({
  guidedPractice: classTeachingSchema.shape.guidedPractice.omit({
    answer: true,
    explanation: true,
  }),
});

export const lessonHelpContextSchema = z
  .object({
    classId: z.string().min(1),
    courseId: z.string().min(1),
    userId: z.string().min(1),
    attempt: z.number().int().positive(),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    nativeLang: z.string().min(1),
    targetLang: z.string().min(1),
    level: z.string().min(1),
    source: lessonHelpSourceSchema,
  })
  .strict();

export async function readLessonHelpSource(
  database: Prisma.TransactionClient,
  classId: string,
  userId: string
) {
  const cls = await database.courseClass.findFirst({
    where: { id: classId, course: { userId } },
    select: {
      id: true,
      courseId: true,
      attempt: true,
      status: true,
      adaptiveSeed: true,
      course: { select: { nativeLang: true, targetLang: true } },
      lesson: { select: { level: true } },
    },
  });
  if (!cls) throw new ClassLessonHelpError('Class not found.', 404);
  if (cls.status === 'GENERATING')
    throw new ClassLessonHelpError('The class is being prepared. Reopen it when ready.', 409);
  if (cls.course.nativeLang === cls.course.targetLang)
    throw new ClassLessonHelpError('This course already uses your native language.', 422);
  const teaching = teachingFromSeed(cls.adaptiveSeed);
  if (!teaching) throw new ClassLessonHelpError('This class has no saved teaching lesson.', 422);
  const ownership = await captureCourseStorage(database, cls.courseId);
  const context = lessonHelpContextSchema.parse({
    classId,
    courseId: cls.courseId,
    userId,
    attempt: cls.attempt,
    sourceHash: createHash('sha256').update(JSON.stringify(teaching)).digest('hex'),
    ...cls.course,
    level: cls.lesson.level,
    source: {
      ...teaching,
      guidedPractice: {
        prompt: teaching.guidedPractice.prompt,
        hint: teaching.guidedPractice.hint,
      },
    },
  });
  const operationId = durableQueueOperationId(
    'interactions',
    JSON.stringify({
      kind: 'CLASS_LESSON_HELP.v1',
      instanceId: ownership.instanceId,
      scopes: ownership.scopes,
      classId,
      userId,
      attempt: context.attempt,
      sourceHash: context.sourceHash,
      nativeLang: context.nativeLang,
      targetLang: context.targetLang,
    })
  );
  return { context, ownership, operationId, teaching };
}

export async function requireLessonHelpSource(
  database: Prisma.TransactionClient,
  context: z.infer<typeof lessonHelpContextSchema>,
  scopes: readonly { subjectId: string; generation: number }[]
) {
  const current = await readLessonHelpSource(database, context.classId, context.userId);
  if (
    !isDeepStrictEqual(current.context, context) ||
    !isDeepStrictEqual(current.ownership.scopes, scopes)
  )
    throw new ClassLessonHelpError('The lesson or its ownership changed. Reopen the class.', 409);
  return current;
}
