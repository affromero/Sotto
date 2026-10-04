import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import type { ClassPreparation } from '../preparation-state';
import type { PracticePreparation } from '@/lib/practice/preparation-state';
import { sottoJobOutbox, sottoJobSnapshot } from '@/lib/sidedoor/jobs/core/job-delivery';
import { generationFailureSchema } from './generation-failure';
import { StorageWriteJournal } from 'thesidedoor-core/storage';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';

const learningFailureSchema = generationFailureSchema;
export type LearningFailure = z.infer<typeof learningFailureSchema>;
type Operation = ClassPreparation | PracticePreparation;

const retainedFailureSchema = z
  .object({
    kind: z.literal('learning_generation_failure'),
    operationId: z.uuid(),
    userId: z.string().min(1),
    courseId: z.string().min(1),
    target: z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('class'),
          classId: z.string().min(1).nullable(),
          attempt: z.number().int().positive().nullable(),
        })
        .strict(),
      z.object({ kind: z.literal('practice'), sessionId: z.uuid() }).strict(),
    ]),
    failure: learningFailureSchema,
  })
  .strict();

async function binding(database: Prisma.TransactionClient, operation: Operation) {
  const practice = 'sessionId' in operation;
  const parent = await sottoJobOutbox(database).read(operation.id);
  if (
    !parent ||
    parent.job.handler !== (practice ? 'practice-preparation' : 'class-preparation') ||
    parent.job.version !== 1
  )
    throw new Error('Generation failure parent does not match preparation.');
  const payload = z
    .object({
      operationId: z.uuid(),
      courseId: z.string().optional(),
      sessionId: z.uuid().optional(),
    })
    .passthrough()
    .parse(parent.job.payload);
  if (
    payload.operationId !== operation.id ||
    (practice
      ? payload.sessionId !== operation.sessionId
      : payload.courseId !== operation.courseId) ||
    !parent.job.scopes.some(
      (s) =>
        s.subjectId === `profile:${operation.userId}` && s.generation === operation.userCreatedAt
    ) ||
    !parent.job.scopes.some(
      (s) =>
        s.subjectId === `course:${operation.courseId}` && s.generation === operation.courseCreatedAt
    )
  )
    throw new Error('Generation failure ownership does not match preparation.');
  const writes = new StorageWriteJournal(
    { query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
    'postgres',
    SIDEDOOR_STATE_ID
  );
  for (const scope of parent.job.scopes)
    if (await writes.tombstone(scope.subjectId))
      throw new Error('Generation failure scope is being erased.');
  return parent;
}

async function targetIdentity(
  database: Prisma.TransactionClient,
  operation: Operation,
  writing = false
) {
  if ('sessionId' in operation) {
    const session = await database.practiceSession.findFirst({
      where: { id: operation.sessionId, courseId: operation.courseId },
      select: { id: true },
    });
    if (!session) throw new Error('Generation failure practice identity changed.');
    return { kind: 'practice' as const, sessionId: session.id };
  }
  const classId = operation.intent?.classId ?? operation.classId;
  if (!classId) return { kind: 'class' as const, classId: null, attempt: null };
  const attempt = operation.intent?.attempt ?? 1;
  const cls = await database.courseClass.findUnique({
    where: { id: classId },
    select: { id: true, courseId: true, attempt: true },
  });
  if (
    (cls && cls.courseId !== operation.courseId) ||
    (writing && (!cls || cls.attempt !== attempt))
  )
    throw new Error('Generation failure class attempt changed.');
  return { kind: 'class' as const, classId, attempt };
}

/** The caller validates authority and commits known failure and private evidence together. */
export async function writeLearningFailure(
  database: Prisma.TransactionClient,
  operation: Operation,
  fingerprint: string,
  failure: LearningFailure
) {
  const parent = await binding(database, operation);
  if (parent.fingerprint !== fingerprint || !['FAILED', 'UNRESOLVED'].includes(operation.status))
    throw new Error('Generation failure cannot replace completed or changed work.');
  const diagnostic = learningFailureSchema.parse(failure);
  const existing = await readLearningFailure(database, operation);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(diagnostic))
      throw new Error('Generation failure cannot overwrite a sealed diagnostic.');
    return;
  }
  if (parent.complete) throw new Error('Generation failure cannot replace completed work.');
  const target = await targetIdentity(database, operation, true);
  const value = retainedFailureSchema.parse({
    kind: 'learning_generation_failure',
    operationId: operation.id,
    userId: operation.userId,
    courseId: operation.courseId,
    target,
    failure: diagnostic,
  });
  const snapshot = sottoJobSnapshot(database);
  await snapshot.createForJob({ id: operation.id, fingerprint });
  await snapshot.append(operation.id, fingerprint, 0, [value]);
  await snapshot.seal(operation.id, fingerprint);
}

/** Old operations have no private snapshot. Malformed and erased records remain errors. */
export async function readLearningFailure(
  database: Prisma.TransactionClient,
  operation: Operation
) {
  const parent = await binding(database, operation);
  let page;
  try {
    page = await sottoJobSnapshot(database).read(operation.id, parent.fingerprint, 0);
  } catch (error) {
    if (error instanceof Error && error.message === 'Snapshot is missing') return null;
    throw error;
  }
  if (page.pages !== 1 || page.next !== null || page.items.length !== 1)
    throw new Error('Generation failure snapshot is not a single result.');
  const target = await targetIdentity(database, operation);
  const value = retainedFailureSchema.parse(page.items[0]);
  if (
    value.operationId !== operation.id ||
    value.userId !== operation.userId ||
    value.courseId !== operation.courseId ||
    JSON.stringify(value.target) !== JSON.stringify(target)
  )
    throw new Error('Generation failure snapshot identity changed.');
  return value.failure;
}

/** Only static text crosses the learner API. Private evidence never participates in serialization. */
export function learningFailureReason(failure: LearningFailure) {
  if (['teaching_rejected', 'review_protocol', 'section_quality'].includes(failure.category))
    return 'The generated lesson did not pass teaching review. You can start a new attempt.';
  if (failure.category === 'database_conflict')
    return 'Generation could not finish saving its results. You can start a new attempt.';
  return 'Generation failed. You can start a new attempt.';
}
