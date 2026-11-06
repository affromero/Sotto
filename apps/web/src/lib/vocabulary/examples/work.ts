import { z } from 'zod';
import { delegationBindingSchema } from 'thesidedoor-core/runtime/delegation';
import type { Prisma } from '@/generated/prisma/client';
import { durableQueueOperationId } from '@/lib/sidedoor/jobs/core/durable-queue';
import { sottoJobOutbox, sottoJobSnapshot } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import {
  requireVocabularyExamplesSource,
  vocabularyExamplesContextSchema,
  VocabularyExamplesError,
} from './source';

export const vocabularyExamplesSchema = z
  .array(
    z
      .object({
        sentence: z.string().trim().min(1).max(1000),
        translation: z.string().trim().min(1).max(1000),
      })
      .strict()
  )
  .length(2);

export const vocabularyExamplesWorkSchema = z
  .object({
    kind: z.literal('VOCABULARY_EXAMPLES'),
    context: vocabularyExamplesContextSchema,
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

export const vocabularyExamplesOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('READY') }).strict(),
  z
    .object({ status: z.literal('FAILED'), error: z.string().min(1), uncertain: z.boolean() })
    .strict(),
]);

export async function retainVocabularyExamples(
  database: Prisma.TransactionClient,
  id: string,
  fingerprint: string,
  outcome: z.infer<typeof vocabularyExamplesOutcomeSchema>
) {
  const snapshot = sottoJobSnapshot(database);
  await snapshot.createForJob({ id, fingerprint });
  await snapshot.append(id, fingerprint, 0, [outcome]);
  await snapshot.seal(id, fingerprint);
}

export async function readVocabularyExamplesOutcome(
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
    throw new Error('The saved examples are incomplete.');
  return vocabularyExamplesOutcomeSchema.parse(page.items[0]);
}

export function nextVocabularyExamplesRetry(id: string) {
  return durableQueueOperationId('interactions', `VOCABULARY_EXAMPLES.retry.v1:${id}`);
}

export async function readCurrentVocabularyExamples(
  database: Prisma.TransactionClient,
  context: z.infer<typeof vocabularyExamplesContextSchema>,
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
    if (record.job.handler !== 'interactions' || record.job.version !== 3)
      throw new VocabularyExamplesError('This request belongs to another operation.', 409);
    const work = vocabularyExamplesWorkSchema.parse(record.job.payload);
    if (
      work.previousOperationId !== previous ||
      JSON.stringify(work.context) !== JSON.stringify({ ...context, level: work.context.level }) ||
      JSON.stringify(record.job.scopes) !== JSON.stringify(scopes)
    )
      throw new VocabularyExamplesError('The saved examples belong to another flashcard.', 409);
    await requireVocabularyExamplesSource(database, work.context, record.job.scopes);
    const outcome = await readVocabularyExamplesOutcome(database, id, record.fingerprint);
    const blocking = await sottoJobExecutions(database).blockingStatus(id, record.fingerprint);
    const canRetry =
      record.complete &&
      outcome?.status === 'FAILED' &&
      !outcome.uncertain &&
      !blocking &&
      index < 2;
    if (canRetry) {
      const next = nextVocabularyExamplesRetry(id);
      if (await sottoJobOutbox(database).read(next)) {
        previous = id;
        id = next;
        continue;
      }
    }
    return { operationId: id, previousOperationId: previous, record, outcome, canRetry };
  }
  throw new VocabularyExamplesError('Example retries require server review.', 409);
}
