import { z } from 'zod';
import { classLessonHelpSchema } from '@sotto/shared';
import { delegationBindingSchema } from 'thesidedoor-core/runtime/delegation';
import type { Prisma } from '@/generated/prisma/client';
import { durableQueueOperationId } from '@/lib/sidedoor/jobs/core/durable-queue';
import { sottoJobOutbox, sottoJobSnapshot } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import {
  ClassLessonHelpError,
  lessonHelpContextSchema,
  requireLessonHelpSource,
} from './lesson-source';

export const lessonHelpWorkSchema = z
  .object({
    kind: z.literal('CLASS_LESSON_HELP'),
    context: lessonHelpContextSchema,
    previousOperationId: z.uuid().nullable(),
    grant: delegationBindingSchema,
    selection: z
      .object({
        provider: z.string(),
        model: z.string(),
        endpoint: z.string().optional(),
        isolatedImage: z.string().optional(),
        credentialFingerprint: z.string().nullable(),
        moderationCredentialFingerprint: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

export const lessonHelpOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('READY'), help: classLessonHelpSchema }).strict(),
  z
    .object({ status: z.literal('FAILED'), error: z.string().min(1), uncertain: z.boolean() })
    .strict(),
]);

export async function retainLessonHelpOutcome(
  database: Prisma.TransactionClient,
  id: string,
  fingerprint: string,
  outcome: z.infer<typeof lessonHelpOutcomeSchema>
) {
  const snapshot = sottoJobSnapshot(database);
  await snapshot.createForJob({ id, fingerprint });
  await snapshot.append(id, fingerprint, 0, [outcome]);
  await snapshot.seal(id, fingerprint);
}

export async function readLessonHelpOutcome(
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
    throw new Error('The saved lesson help is incomplete.');
  return lessonHelpOutcomeSchema.parse(page.items[0]);
}

/** Walk only explicit retries of completed, confirmed failures. Unknown work never advances. */
export async function readCurrentLessonHelp(
  database: Prisma.TransactionClient,
  context: z.infer<typeof lessonHelpContextSchema>,
  baseId: string,
  scopes: readonly { subjectId: string; generation: number }[]
) {
  let id = baseId;
  let previous: string | null = null;
  for (let index = 0; index < 3; index++) {
    const record = await sottoJobOutbox(database).read(id);
    if (!record)
      return {
        operationId: id,
        previousOperationId: previous,
        record: null,
        outcome: null,
        canRetry: false,
      };
    if (record.job.handler !== 'interactions' || record.job.version !== 2)
      throw new ClassLessonHelpError(
        'This lesson-help identity belongs to another operation.',
        409
      );
    const work = lessonHelpWorkSchema.parse(record.job.payload);
    if (
      work.previousOperationId !== previous ||
      JSON.stringify(work.context) !== JSON.stringify(context)
    )
      throw new ClassLessonHelpError('The saved help belongs to different lesson content.', 409);
    await requireLessonHelpSource(database, work.context, record.job.scopes);
    if (JSON.stringify(record.job.scopes) !== JSON.stringify(scopes))
      throw new ClassLessonHelpError('Lesson-help ownership changed.', 409);
    const outcome = await readLessonHelpOutcome(database, id, record.fingerprint);
    const blocking = await sottoJobExecutions(database).blockingStatus(id, record.fingerprint);
    const retryable =
      record.complete &&
      outcome?.status === 'FAILED' &&
      !outcome.uncertain &&
      !blocking &&
      index < 2;
    if (retryable) {
      const next = durableQueueOperationId('interactions', `CLASS_LESSON_HELP.retry.v1:${id}`);
      if (await sottoJobOutbox(database).read(next)) {
        previous = id;
        id = next;
        continue;
      }
    }
    return { operationId: id, previousOperationId: previous, record, outcome, canRetry: retryable };
  }
  throw new ClassLessonHelpError('Lesson-help retries require review on the server.', 409);
}

export function nextLessonHelpRetry(id: string) {
  return durableQueueOperationId('interactions', `CLASS_LESSON_HELP.retry.v1:${id}`);
}
