import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@/generated/prisma/client';
import type { OutboxJob } from 'thesidedoor-core/runtime/outbox';
import { createInitialStitchKey } from '@/lib/audio/stitch-identity';
import { sottoJobOutbox, sottoJobSnapshot } from '@/lib/sidedoor/jobs/core/job-delivery';
import { initialStitchPayloadSchema } from '@/lib/sidedoor/jobs/initial/initial-stitch-contract';
import { resolvePublishedStorageReference } from '@/lib/sidedoor/storage/migration/storage-publication';

const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const effect = z.object({ id: z.uuid(), fingerprint }).strict();
const outcomeSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('READY'),
      stitchKey: fingerprint,
      versionId: z.uuid(),
      version: z.number().int().nonnegative(),
      audioUrl: z.string().min(1),
      effects: z.array(effect).length(4),
    })
    .strict(),
  z
    .object({
      kind: z.literal('DURATION_FAILED'),
      stitchKey: fingerprint,
      durationSeconds: z.number().nonnegative().finite(),
      limitSeconds: z.number().positive().finite(),
      effects: z.array(effect).length(2),
    })
    .strict(),
  z
    .object({
      kind: z.literal('PROCESSING_FAILED'),
      stitchKey: fingerprint,
      failureCode: z.literal('audio_stitching_failed'),
      effects: z.array(effect).length(2),
    })
    .strict(),
]);
export type InitialStitchOutcome = z.infer<typeof outcomeSchema>;

function validateOutcome(parent: OutboxJob, value: unknown): InitialStitchOutcome {
  if (!parent.complete || parent.job.handler !== 'audio-stitching' || parent.job.version !== 2)
    throw new Error('Initial stitching outcome requires its completed parent');
  const { inputs, outputs } = initialStitchPayloadSchema.parse(parent.job.payload);
  const outcome = outcomeSchema.parse(value);
  const expected =
    outcome.kind === 'READY'
      ? [outputs.readyNotification, outputs.readyStatus, outputs.pdf, outputs.waveform]
      : [outputs.failedNotification, outputs.failedStatus];
  if (
    outcome.stitchKey !== createInitialStitchKey(parent.fingerprint) ||
    new Set(outcome.effects.map((item) => item.id)).size !== expected.length ||
    outcome.effects.some((item) => !expected.includes(item.id))
  )
    throw new Error('Initial stitching outcome does not match its admitted effects');
  if (
    outcome.kind === 'READY' &&
    (outcome.versionId !== outputs.versionId ||
      outcome.version !==
        inputs.previousAudio.currentVersion + (inputs.previousAudio.audioUrl ? 1 : 0))
  )
    throw new Error('Initial stitching outcome version does not match admission');
  if (outcome.kind === 'DURATION_FAILED' && outcome.durationSeconds <= outcome.limitSeconds)
    throw new Error('Initial stitching duration failure has no exceeded limit');
  return outcome;
}

async function validateEffects(
  database: Prisma.TransactionClient,
  parent: OutboxJob,
  outcome: InitialStitchOutcome
) {
  const { inputs, outputs } = initialStitchPayloadSchema.parse(parent.job.payload);
  const outbox = sottoJobOutbox(database);
  for (const effect of outcome.effects) {
    const child = await outbox.read(effect.id);
    if (
      !child ||
      child.fingerprint !== effect.fingerprint ||
      child.job.version !== 1 ||
      !isDeepStrictEqual(child.job.scopes, parent.job.scopes)
    )
      throw new Error('Initial stitching outcome effect is missing or changed');
    const binding = z
      .object({
        parentOperationId: z.literal(parent.job.id),
        parentFingerprint: z.literal(parent.fingerprint),
        contributorId: z.literal(inputs.storage.userId),
        storage: initialStitchPayloadSchema.shape.inputs.shape.storage,
      })
      .parse(child.job.payload);
    if (!isDeepStrictEqual(binding.storage, inputs.storage))
      throw new Error('Initial stitching outcome effect ownership changed');
    if ([outputs.readyNotification, outputs.failedNotification].includes(effect.id)) {
      if (child.job.handler !== 'notifications')
        throw new Error('Initial stitching notification handler changed');
      z.object({
        userId: z.literal(inputs.storage.userId),
        type: z.literal(outcome.kind === 'READY' ? 'EPISODE_READY' : 'EPISODE_FAILED'),
        data: z.object({ episodeId: z.literal(inputs.episodeId) }).strict(),
      }).parse(child.job.payload);
    } else if ([outputs.readyStatus, outputs.failedStatus].includes(effect.id)) {
      if (child.job.handler !== 'episode-status')
        throw new Error('Initial stitching status handler changed');
      z.object({
        episodeId: z.literal(inputs.episodeId),
        status: z.literal(outcome.kind === 'READY' ? 'READY' : 'FAILED'),
      }).parse(child.job.payload);
    } else {
      const handler = effect.id === outputs.pdf ? 'pdf-generation' : 'waveform-generation';
      if (outcome.kind !== 'READY' || child.job.handler !== handler)
        throw new Error('Initial stitching artifact handler changed');
      z.object({
        episodeId: z.literal(inputs.episodeId),
        userId: z.literal(inputs.storage.userId),
        episodeVersion: z.literal(outcome.version),
        stitchKey: z.literal(outcome.stitchKey),
      }).parse(child.job.payload);
    }
  }
}

/** Persist only inside the publication transaction, after completing the parent and enqueuing effects. */
export async function writeInitialStitchOutcome(
  database: Prisma.TransactionClient,
  identity: { id: string; fingerprint: string },
  value: InitialStitchOutcome
) {
  const outbox = sottoJobOutbox(database);
  const parent = await outbox.read(identity.id);
  if (!parent || parent.fingerprint !== identity.fingerprint)
    throw new Error('Initial stitching outcome parent changed');
  const outcome = validateOutcome(parent, value);
  await validateEffects(database, parent, outcome);
  const snapshot = sottoJobSnapshot(database);
  await snapshot.createForJob(identity);
  await snapshot.append(identity.id, identity.fingerprint, 0, [outcome]);
  await snapshot.seal(identity.id, identity.fingerprint);
}

/** Missing or erased snapshots are never repaired while reading completion proof. */
export async function readInitialStitchOutcome(
  database: Prisma.TransactionClient,
  parent: OutboxJob
) {
  const page = await sottoJobSnapshot(database).read(parent.job.id, parent.fingerprint, 0);
  if (page.pages !== 1 || page.next !== null || page.items.length !== 1)
    throw new Error('Initial stitching outcome must have exactly one sealed result');
  return validateOutcome(parent, page.items[0]);
}

/** The caller reauthorizes the original attempt and checks current generation before replay. */
export async function verifyInitialStitchPublication(
  database: Prisma.TransactionClient,
  parent: OutboxJob,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  const outcome = await readInitialStitchOutcome(database, parent);
  await validateEffects(database, parent, outcome);
  signal?.throwIfAborted();
  if (outcome.kind !== 'READY') return outcome;
  const { inputs } = initialStitchPayloadSchema.parse(parent.job.payload);
  const version = await database.episodeVersion.findUnique({
    where: { id: outcome.versionId },
    select: { episodeId: true, version: true, audioUrl: true, interactionId: true },
  });
  if (
    version?.episodeId !== inputs.episodeId ||
    version.version !== outcome.version ||
    version.interactionId !== null
  )
    throw new Error('Initial stitching publication version changed');
  const episode = await database.episode.findUnique({
    where: { id: inputs.episodeId },
    select: { audioUrl: true },
  });
  if (!episode?.audioUrl) throw new Error('Initial stitching publication audio is missing');
  const episodeSource = await resolvePublishedStorageReference(database, {
    consumer: `episode:${inputs.episodeId}:audio`,
    originalReference: outcome.audioUrl,
    currentReference: episode.audioUrl,
    signal,
  });
  const versionSource = await resolvePublishedStorageReference(database, {
    consumer: `episode-version:${outcome.versionId}:audio`,
    originalReference: outcome.audioUrl,
    currentReference: version.audioUrl,
    signal,
  });
  if (
    !episodeSource ||
    !versionSource ||
    episodeSource.current.assetId !== versionSource.current.assetId
  )
    throw new Error('Initial stitching publication storage attribution changed');
  return outcome;
}
