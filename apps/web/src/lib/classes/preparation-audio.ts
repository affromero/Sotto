import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { delegationBindingSchema } from 'thesidedoor-core/runtime/delegation';
import { sqlStateBackend } from 'thesidedoor-core/storage/sql';
import type { Prisma } from '@/generated/prisma/client';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { classPreparationGrant } from './preparation-grant';
import { classPreparationStore, validateClassPreparation } from './preparation';
import { PreparationConflictError, type ClassPreparation } from './preparation-state';

const lineageSchema = z
  .object({
    version: z.literal(1),
    episodeId: z.string().min(1),
    operationId: z.uuid(),
    courseId: z.string().min(1),
    userId: z.string().min(1),
    grant: delegationBindingSchema,
    episodeCreatedAt: z.number().int().nonnegative(),
    audioGenerationKey: z.string().min(1),
  })
  .strict();

function lineageBackend(database: Prisma.TransactionClient, episodeId: string) {
  return sqlStateBackend(
    {
      query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
    },
    'postgres',
    `${SIDEDOOR_STATE_ID}:preparation-audio:${createHash('sha256').update(episodeId).digest('hex')}`
  );
}

/** Called within the segment/outbox admission transaction, before audio children commit. */
export async function registerPreparationAudio(
  database: Prisma.TransactionClient,
  operation: ClassPreparation,
  episodeId: string,
  audioGenerationKey: string
) {
  const current = await validateClassPreparation(database, operation.courseId, operation.id);
  if (current.deferAudio)
    throw new PreparationConflictError('Scheduled audio requires learner review.');
  const episode = await database.episode.findUnique({
    where: { id: episodeId },
    select: { userId: true, createdAt: true, audioGenerationKey: true },
  });
  if (episode?.userId !== current.userId)
    throw new PreparationConflictError('The listening episode owner changed.');
  if (episode.audioGenerationKey !== audioGenerationKey)
    throw new PreparationConflictError('The listening audio generation changed.');
  const lineage = lineageSchema.parse({
    version: 1,
    episodeId,
    audioGenerationKey,
    operationId: current.id,
    courseId: current.courseId,
    userId: current.userId,
    grant: current.grant,
    episodeCreatedAt: episode.createdAt.getTime(),
  });
  const backend = lineageBackend(database, episodeId);
  const existing = await backend.read();
  if (existing) {
    const previous = lineageSchema.parse(existing.state);
    if (
      previous.operationId !== lineage.operationId ||
      previous.grant.fingerprint !== lineage.grant.fingerprint ||
      previous.episodeCreatedAt !== lineage.episodeCreatedAt ||
      previous.audioGenerationKey !== audioGenerationKey
    )
      throw new PreparationConflictError('The listening episode preparation changed.');
  } else if (!(await backend.compareAndSwap(null, { revision: randomUUID(), state: lineage }))) {
    throw new PreparationConflictError('Listening preparation changed concurrently.');
  }
  await classPreparationStore(database, current.courseId).transact((state) => {
    if (!state || state.id !== current.id) throw new PreparationConflictError();
    if (!state.audioEpisodeIds.includes(episodeId)) state.audioEpisodeIds.push(episodeId);
    state.updatedAt = Date.now();
  });
}

/** Independently stored lineage survives replacement of the course's latest preparation row. */
export async function readPreparationAudioBinding(
  database: Prisma.TransactionClient,
  episodeId: string
) {
  const stored = await lineageBackend(database, episodeId).read();
  if (!stored) return null;
  const lineage = lineageSchema.parse(stored.state);
  if (lineage.episodeId !== episodeId)
    throw new PreparationConflictError('The listening episode changed.');
  const episode = await database.episode.findUnique({
    where: { id: episodeId },
    select: { userId: true, createdAt: true },
  });
  if (
    episode?.userId !== lineage.userId ||
    episode.createdAt.getTime() !== lineage.episodeCreatedAt
  )
    throw new PreparationConflictError('The listening episode owner changed.');
  return lineage;
}

export async function validatePreparationAudio(
  database: Prisma.TransactionClient,
  episodeId: string,
  audioGenerationKey: string
) {
  const lineage = await readPreparationAudioBinding(database, episodeId);
  if (!lineage || lineage.audioGenerationKey !== audioGenerationKey) return;
  const grant = await classPreparationGrant(database, {
    id: lineage.operationId,
    courseId: lineage.courseId,
    userId: lineage.userId,
  }).read(lineage.grant);
  if (grant.status === 'revoked' || Date.now() >= grant.grant.expiresAt)
    throw new PreparationConflictError('The listening preparation is no longer authorized.');
}
