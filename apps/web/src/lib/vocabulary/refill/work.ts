import { z } from 'zod';
import { delegationBindingSchema } from 'thesidedoor-core/runtime/delegation';
import type { Prisma } from '@/generated/prisma/client';
import { durableQueueOperationId } from '@/lib/sidedoor/jobs/core/durable-queue';
import { sottoJobSnapshot } from '@/lib/sidedoor/jobs/core/job-delivery';
import { vocabularyRefillContextSchema } from './source';

export const generatedVocabularySchema = z
  .object({
    words: z
      .array(
        z
          .object({
            lemma: z.string().trim().min(1).max(200),
            meaning: z.string().trim().min(1).max(500),
            partOfSpeech: z.string().trim().max(80).nullable(),
          })
          .strict()
      )
      .min(4)
      .max(8),
  })
  .strict();

export const vocabularyRefillWorkSchema = z
  .object({
    kind: z.literal('VOCABULARY_REFILL'),
    context: vocabularyRefillContextSchema,
    triggerSessionId: z.string().nullable(),
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

export const vocabularyRefillOutcomeSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('READY'),
      added: z.number().int().nonnegative(),
      wordIds: z.array(z.string().min(1)).min(1).max(8),
    })
    .strict(),
  z
    .object({ status: z.literal('FAILED'), error: z.string().min(1), uncertain: z.boolean() })
    .strict(),
]);

export function vocabularyRefillOperationId(courseId: string, generation: number) {
  return durableQueueOperationId('interactions', `VOCABULARY_REFILL.v1:${courseId}:${generation}`);
}

export async function retainVocabularyRefill(
  database: Prisma.TransactionClient,
  id: string,
  fingerprint: string,
  outcome: z.infer<typeof vocabularyRefillOutcomeSchema>
) {
  const snapshot = sottoJobSnapshot(database);
  await snapshot.createForJob({ id, fingerprint });
  await snapshot.append(id, fingerprint, 0, [outcome]);
  await snapshot.seal(id, fingerprint);
}

export async function readVocabularyRefillOutcome(
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
    throw new Error('The saved vocabulary refill is incomplete.');
  return vocabularyRefillOutcomeSchema.parse(page.items[0]);
}
