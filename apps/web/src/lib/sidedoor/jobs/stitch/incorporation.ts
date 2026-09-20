import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { AccessError } from 'thesidedoor-core/access';
import { prepareJob, type PreparedJob } from 'thesidedoor-core/runtime/outbox';
import { OptimisticStateStore } from 'thesidedoor-core/storage/optimistic';
import { sqlStateBackend } from 'thesidedoor-core/storage/sql';
import type { Prisma } from '@/generated/prisma/client';
import {
  captureEpisodeStorage,
  validateEpisodeStorage,
} from '@/lib/sidedoor/storage/core/episode-storage';
import {
  requireOriginalSottoAdmission,
  resolveSottoRequest,
} from '@/lib/sidedoor/access/core/request-identity';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';

const attemptSchema = z
  .object({
    operationId: z.uuid().nullable(),
    fingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
  })
  .strict();

function incorporationAttemptStore(database: Prisma.TransactionClient, interactionId: string) {
  const key = createHash('sha256')
    .update(JSON.stringify([SIDEDOOR_STATE_ID, interactionId]))
    .digest('hex');
  return new OptimisticStateStore({
    backend: sqlStateBackend(
      {
        query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      },
      'postgres',
      `sotto-incorporation:${key}`
    ),
    parse: (value) => attemptSchema.parse(value),
    initial: () => ({ operationId: null, fingerprint: null }),
  });
}

/** Phase names alone cannot distinguish an old queue delivery from a later attempt. */
export async function requireIncorporationAttempt(
  database: Prisma.TransactionClient,
  interactionId: string,
  operationId: string,
  fingerprint: string
) {
  const current = await incorporationAttemptStore(database, interactionId).read();
  if (current.operationId !== operationId || current.fingerprint !== fingerprint)
    throw new IncorporationAdmissionError('The incorporation attempt changed', 409);
}

export class IncorporationAdmissionError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409
  ) {
    super(message);
    this.name = 'IncorporationAdmissionError';
  }
}

/** Select generation inputs explicitly so unrelated playback and feedback changes remain valid. */
export async function readIncorporationInputs(
  database: Prisma.TransactionClient,
  episodeId: string,
  interactionId: string
) {
  const interaction = await database.interaction.findUnique({
    where: { id: interactionId },
    select: {
      id: true,
      episodeId: true,
      userId: true,
      createdAt: true,
      status: true,
      incorporated: true,
      question: true,
      answer: true,
      timestamp: true,
      visibility: true,
      episode: {
        select: {
          id: true,
          createdAt: true,
          userId: true,
          status: true,
          source: true,
          language: true,
          aiModel: true,
          ttsProvider: true,
          ttsModel: true,
          audioUrl: true,
          currentVersion: true,
          lastCompletedStitchKey: true,
          segments: {
            orderBy: { order: 'asc' },
            select: {
              id: true,
              createdAt: true,
              order: true,
              startTime: true,
              duration: true,
              speaker: true,
              text: true,
              audioUrl: true,
              version: true,
              ttsProvider: true,
              ttsModel: true,
              ttsVoiceId: true,
            },
          },
          voices: {
            orderBy: { speaker: 'asc' },
            select: { speaker: true, voiceId: true, provider: true },
          },
          discovery: { select: { tone: true, audienceLevel: true, audience: true } },
        },
      },
    },
  });
  if (!interaction || interaction.episodeId !== episodeId)
    throw new IncorporationAdmissionError('Interaction not found', 404);
  return interaction;
}

type Inputs = Awaited<ReturnType<typeof readIncorporationInputs>>;

export function incorporationInputFingerprint(inputs: Inputs) {
  // Status is checked separately at each pipeline stage.
  const interaction = Object.fromEntries(
    Object.entries(inputs).filter(([key]) => key !== 'status' && key !== 'episode')
  );
  const episodeInputs = Object.fromEntries(
    Object.entries(inputs.episode).filter(([key]) => key !== 'status')
  );
  return createHash('sha256')
    .update(JSON.stringify({ ...interaction, episode: episodeInputs }))
    .digest('hex');
}

function requireReady(inputs: Inputs) {
  if (inputs.episode.source === 'IMPORT')
    throw new IncorporationAdmissionError(
      'Incorporation not yet supported for imported episodes',
      400
    );
  if (!['ANSWERED', 'RESOLVED'].includes(inputs.status) || inputs.incorporated)
    throw new IncorporationAdmissionError(
      `Cannot incorporate interaction with status "${inputs.status}"`,
      409
    );
  if (inputs.episode.status !== 'READY')
    throw new IncorporationAdmissionError(
      `Episode is currently "${inputs.episode.status}", must be READY`,
      409
    );
}

export async function captureIncorporation(
  database: Prisma.TransactionClient,
  request: Request,
  episodeId: string,
  interactionId: string
) {
  const identity = await resolveSottoRequest(database, request);
  if (!identity || identity.kind !== 'content') throw new AccessError('unauthorized');
  const inputs = await readIncorporationInputs(database, episodeId, interactionId);
  if (inputs.episode.userId !== identity.userId) throw new AccessError('forbidden');
  if (inputs.visibility === 'PRIVATE' && inputs.userId !== identity.userId)
    throw new AccessError('forbidden');
  requireReady(inputs);
  const storage = await captureEpisodeStorage(database, episodeId, [inputs.userId]);
  return { identity, inputs, storage, fingerprint: incorporationInputFingerprint(inputs) };
}

export type IncorporationAdmission = Awaited<ReturnType<typeof captureIncorporation>>;

export function incorporationPosition(inputs: Inputs) {
  let insertAfterOrder = 0;
  let speaker = inputs.episode.segments[0]?.speaker ?? 'HOST';
  for (const segment of inputs.episode.segments) {
    insertAfterOrder = segment.order;
    speaker = segment.speaker;
    if (inputs.timestamp <= (segment.startTime ?? 0) + (segment.duration ?? 0)) break;
  }
  return { insertAfterOrder, speaker };
}

/** Prepare once after AI succeeds, outside retryable database transactions. */
export function prepareIncorporation(
  admission: IncorporationAdmission,
  generatedText: string,
  operationId?: string
) {
  if (!generatedText.trim()) throw new Error('Incorporation generated no text');
  const { insertAfterOrder, speaker } = incorporationPosition(admission.inputs);
  return prepareJob({
    ...(operationId ? { id: operationId } : {}),
    namespace: SIDEDOOR_STATE_ID,
    handler: 'segment-regeneration',
    version: 1,
    payload: {
      episodeId: admission.inputs.episodeId,
      interactionId: admission.inputs.id,
      insertAfterOrder,
      speaker,
      newText: generatedText,
      inputFingerprint: admission.fingerprint,
      storage: admission.storage,
    },
    scopes: admission.storage.scopes,
    delivery: { attempts: 2, priority: 0, availableAt: 0 },
  });
}

/** Admission, status transitions and durable work are one application commit. */
export async function commitIncorporation(
  database: Prisma.TransactionClient,
  request: Request,
  admission: IncorporationAdmission,
  job: PreparedJob
) {
  await requireOriginalSottoAdmission(database, request, admission.identity);
  const inputs = await readIncorporationInputs(
    database,
    admission.inputs.episodeId,
    admission.inputs.id
  );
  requireReady(inputs);
  if (
    inputs.status !== admission.inputs.status ||
    incorporationInputFingerprint(inputs) !== admission.fingerprint
  )
    throw new IncorporationAdmissionError(
      'Episode or interaction inputs changed during generation',
      409
    );
  await validateEpisodeStorage(database, inputs.episodeId, admission.storage, [inputs.userId]);
  const payload = job.payload;
  if (
    !payload ||
    Array.isArray(payload) ||
    typeof payload !== 'object' ||
    typeof payload.newText !== 'string'
  )
    throw new Error('Invalid incorporation job');
  const expected = prepareIncorporation(admission, payload.newText, job.id);
  if (!isDeepStrictEqual(expected, job))
    throw new Error('Incorporation job does not match admission');
  const outbox = sottoJobOutbox(database);
  if (await outbox.read(job.id))
    throw new IncorporationAdmissionError('The incorporation operation was already submitted', 409);
  const record = await outbox.enqueue(job);
  await incorporationAttemptStore(database, inputs.id).transact((state) => {
    state.operationId = record.job.id;
    state.fingerprint = record.fingerprint;
  });
  await database.interaction.update({
    where: { id: inputs.id },
    data: { status: 'INCORPORATING' },
  });
  await database.episode.update({ where: { id: inputs.episodeId }, data: { status: 'UPDATING' } });
  return record;
}
