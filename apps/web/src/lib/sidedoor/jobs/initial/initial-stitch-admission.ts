import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { AccessError } from 'thesidedoor-core/access';
import { prepareJob, type PreparedJob, type OutboxJob } from 'thesidedoor-core/runtime/outbox';
import { OptimisticStateStore } from 'thesidedoor-core/storage/optimistic';
import { StorageWriteJournal } from 'thesidedoor-core/storage';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { sqlStateBackend } from 'thesidedoor-core/storage/sql';
import type { Prisma } from '@/generated/prisma/client';
import type { CredentialExecutionAuthority } from '@/lib/sidedoor/credentials/runtime/credential-execution';
import {
  captureInitialStitchInputs,
  validateInitialStitchInputs,
  validateCompletedInitialStitchInputs,
  type InitialStitchInputs,
} from '@/lib/sidedoor/jobs/initial/initial-stitch-inputs';
import { verifyInitialStitchPublication } from '@/lib/sidedoor/jobs/initial/initial-stitch-outcome';
import { validateEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import {
  initialStitchPayloadSchema,
  initialStitchSoundPolicySchema,
  prepareStitchOutputs,
  type InitialStitchOutputs,
} from '@/lib/sidedoor/jobs/initial/initial-stitch-contract';

const attemptSchema = z
  .object({
    operationId: z.uuid().nullable(),
    fingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
  })
  .strict();

function initialStitchAttemptStore(database: Prisma.TransactionClient, episodeId: string) {
  const key = createHash('sha256')
    .update(JSON.stringify([SIDEDOOR_STATE_ID, episodeId]))
    .digest('hex');
  return new OptimisticStateStore({
    backend: sqlStateBackend(
      {
        query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      },
      'postgres',
      `sotto-initial-stitch:${key}`
    ),
    parse: (value) => attemptSchema.parse(value),
    initial: () => ({ operationId: null, fingerprint: null }),
  });
}

/** An initial generation proves its own attempt, independent of interaction incorporation. */
export async function requireInitialStitchAttempt(
  database: Prisma.TransactionClient,
  episodeId: string,
  operationId: string,
  fingerprint: string
) {
  const current = await initialStitchAttemptStore(database, episodeId).read();
  if (current.operationId !== operationId || current.fingerprint !== fingerprint)
    throw new AccessError('conflict', 'The initial stitching attempt changed');
}

export type InitialStitchSoundPolicy = z.infer<typeof initialStitchSoundPolicySchema>;

async function validateExistingInitialStitch(
  database: Prisma.TransactionClient,
  authorize: CredentialExecutionAuthority,
  existing: OutboxJob,
  signal?: AbortSignal
) {
  const payload = initialStitchPayloadSchema.parse(existing.job.payload);
  const capturedInputs = payload.inputs;
  const expected = prepareInitialStitch(
    capturedInputs,
    payload.soundPolicy,
    existing.job.id,
    payload.outputs
  );
  if (!isDeepStrictEqual(existing.job, expected))
    throw new AccessError('conflict', 'The initial stitching contract changed');
  await requireInitialStitchAttempt(
    database,
    capturedInputs.episodeId,
    existing.job.id,
    existing.fingerprint
  );
  if (!existing.complete) {
    await validateInitialStitchInputs(database, authorize, capturedInputs, 'STITCHING', signal);
    return payload;
  }
  const identity = await authorize(database);
  if (identity.userId !== capturedInputs.storage.userId)
    throw new AccessError('forbidden', 'The completed stitching owner changed');
  await validateEpisodeStorage(database, capturedInputs.episodeId, capturedInputs.storage);
  const outcome = await verifyInitialStitchPublication(database, existing, signal);
  await validateCompletedInitialStitchInputs(
    database,
    authorize,
    capturedInputs,
    outcome.kind === 'READY'
      ? {
          audioUrl: outcome.audioUrl,
          currentVersion: outcome.version,
          lastCompletedStitchKey: outcome.stitchKey,
        }
      : capturedInputs.previousAudio,
    outcome.kind === 'READY' ? 'READY' : 'FAILED',
    signal
  );
  if (outcome.kind !== 'READY') {
    const episode = await database.episode.findUniqueOrThrow({
      where: { id: capturedInputs.episodeId },
      select: { failedAtStatus: true },
    });
    if (episode.failedAtStatus !== 'STITCHING')
      throw new AccessError('conflict', 'The failed stitching stage changed');
  }
  signal?.throwIfAborted();
  return payload;
}

/** Recovery only reads and proves the current attempt. It never admits new work. */
export async function verifyCurrentInitialStitch(
  database: Prisma.TransactionClient,
  authorize: CredentialExecutionAuthority,
  episodeId: string,
  generationKey: string,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  const attempt = await initialStitchAttemptStore(database, episodeId).read();
  if (!attempt.operationId || !attempt.fingerprint)
    throw new AccessError('conflict', 'The initial stitching attempt is missing');
  const record = await sottoJobOutbox(database).read(attempt.operationId);
  if (!record || record.fingerprint !== attempt.fingerprint)
    throw new AccessError('conflict', 'The initial stitching attempt changed');
  const payload = await validateExistingInitialStitch(database, authorize, record, signal);
  if (payload.inputs.episodeId !== episodeId || payload.inputs.generationKey !== generationKey)
    throw new AccessError('conflict', 'The stitching generation changed');
  signal?.throwIfAborted();
  return { record, payload };
}

/** Allocate before transaction retries, including when another producer may win admission. */
export function prepareInitialStitchIdentities() {
  return { operationId: randomUUID(), outputs: prepareStitchOutputs() };
}

/** Atomically reconcile concurrent producers using the winning attempt's original payload. */
export async function admitInitialStitch(
  database: Prisma.TransactionClient,
  options: {
    authorize: CredentialExecutionAuthority;
    episodeId: string;
    generationKey: string;
    soundPolicy: InitialStitchSoundPolicy;
    identities: ReturnType<typeof prepareInitialStitchIdentities>;
    fromPhase: 'GENERATING_AUDIO' | 'FAILED';
    signal?: AbortSignal;
  }
) {
  const { authorize, episodeId, generationKey, soundPolicy, fromPhase, signal } = options;
  const identities = structuredClone(options.identities);
  signal?.throwIfAborted();
  const identity = await authorize(database);
  const episode = await database.episode.findUniqueOrThrow({
    where: { id: episodeId },
    select: { userId: true, status: true, audioGenerationKey: true },
  });
  if (episode.userId !== identity.userId)
    throw new AccessError('forbidden', 'The stitching owner changed');
  if (episode.audioGenerationKey !== generationKey)
    throw new AccessError('conflict', 'The audio generation changed');
  if (episode.status === 'STITCHING' || episode.status === 'READY') {
    const { record } = await verifyCurrentInitialStitch(
      database,
      authorize,
      episodeId,
      generationKey,
      signal
    );
    return { kind: 'existing' as const, record };
  }
  if (episode.status !== fromPhase)
    throw new AccessError('conflict', 'The stitching phase changed');
  const pending = await database.segment.count({ where: { episodeId, audioUrl: null } });
  signal?.throwIfAborted();
  if (pending > 0) return { kind: 'waiting' as const };
  const inputs = await captureInitialStitchInputs(
    database,
    authorize,
    episodeId,
    generationKey,
    signal
  );
  const job = prepareInitialStitch(inputs, soundPolicy, identities.operationId, identities.outputs);
  const record = await commitInitialStitch(
    database,
    authorize,
    inputs,
    soundPolicy,
    job,
    fromPhase,
    signal
  );
  return { kind: 'admitted' as const, record };
}

/** Prepare once outside transaction retries; the caller must select an explicit sound policy. */
export function prepareInitialStitch(
  inputs: InitialStitchInputs,
  soundPolicy: InitialStitchSoundPolicy,
  operationId: string = randomUUID(),
  outputs: InitialStitchOutputs = prepareStitchOutputs()
) {
  const payload = initialStitchPayloadSchema.parse({ inputs, soundPolicy, outputs });
  if (Object.values(payload.outputs).includes(operationId))
    throw new AccessError(
      'invalid',
      'Stitch output identities must differ from the parent operation'
    );
  return prepareJob({
    id: operationId,
    namespace: SIDEDOOR_STATE_ID,
    handler: 'audio-stitching',
    version: 2,
    payload: z.json().parse(payload),
    scopes: inputs.storage.scopes,
    delivery: { attempts: 2, priority: 0, availableAt: 0 },
  });
}

/** Run in a Serializable transaction with the original request or generation-job authority. */
export async function commitInitialStitch(
  database: Prisma.TransactionClient,
  authorize: CredentialExecutionAuthority,
  inputs: InitialStitchInputs,
  soundPolicy: InitialStitchSoundPolicy,
  job: PreparedJob,
  fromPhase: 'GENERATING_AUDIO' | 'FAILED',
  signal?: AbortSignal
) {
  const capturedInputs = structuredClone(inputs);
  const prepared = structuredClone(job);
  const payload = initialStitchPayloadSchema.parse(prepared.payload);
  const expected = prepareInitialStitch(capturedInputs, soundPolicy, prepared.id, payload.outputs);
  if (!isDeepStrictEqual(prepared, expected))
    throw new AccessError('invalid', 'The stitching job does not match its admission');
  const outbox = sottoJobOutbox(database);
  const existing = await outbox.read(prepared.id);
  if (existing) {
    if (!isDeepStrictEqual(existing.job, prepared))
      throw new AccessError('conflict', 'The stitching operation already has different inputs');
    await validateExistingInitialStitch(database, authorize, existing, signal);
    signal?.throwIfAborted();
    return existing;
  }
  await validateInitialStitchInputs(database, authorize, capturedInputs, fromPhase, signal);
  if (fromPhase === 'FAILED') {
    const scope = capturedInputs.storage.scopes.find(
      (item) => item.subjectId === `episode:${capturedInputs.episodeId}`
    );
    if (!scope) throw new AccessError('conflict', 'Episode execution scope is missing');
    const pending = await sottoJobExecutions(database).listUnresolved(scope);
    if (pending.executions.length > 0)
      throw new AccessError(
        'conflict',
        'Resolve pending episode execution cleanup before retrying generation'
      );
    const writes = new StorageWriteJournal(
      {
        query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      },
      'postgres',
      SIDEDOOR_STATE_ID
    );
    let after: string | undefined;
    do {
      signal?.throwIfAborted();
      const page = await writes.list(`episode:${capturedInputs.episodeId}`, { after });
      if (page.intents.some((intent) => intent.status !== 'settled'))
        throw new AccessError(
          'conflict',
          'Resolve pending audio writes before retrying generation'
        );
      after = page.cursor ?? undefined;
    } while (after);
  }
  const record = await outbox.enqueue(prepared);
  await initialStitchAttemptStore(database, capturedInputs.episodeId).transact((state) => {
    state.operationId = record.job.id;
    state.fingerprint = record.fingerprint;
  });
  await database.episode.update({
    where: { id: capturedInputs.episodeId },
    data: {
      status: 'STITCHING',
      failedAtStatus: null,
      failureReason: null,
      activeStitchKey: null,
      activeStitchOwner: null,
    },
  });
  signal?.throwIfAborted();
  return record;
}
