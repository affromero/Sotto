import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { sqlStateBackend } from 'thesidedoor-core/storage/sql';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  assertSottoExecutionOperation,
  verifySottoExecutionOperation,
  type SottoJobExecutionOperation,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import {
  durableEnvelopeSchema,
  durableQueueOperationId,
  validateDurableAuthority,
} from '@/lib/sidedoor/jobs/core/durable-queue';
import { captureEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import {
  resolveStorageInput,
  storageInputSchema,
} from '@/lib/sidedoor/storage/core/storage-inputs';
import { learningProviderInputHash } from '@/lib/learning/preparation/identity';
import { capturePrerequisiteOwnership } from '@/lib/classes/help/lifecycle/prerequisite-ownership';
import {
  captureSottoStorageWriter,
  writeStorageReference,
} from '@/lib/sidedoor/storage/core/storage-write';
import { validateAssessmentAudioLineage } from './assessment-audio-lineage';
import { AssessmentFenceConflict } from '../lifecycle/assessment-fence';
import { resolveOwnedClassStorage } from '../lifecycle/assessment-storage-relocation';
import { matchesPublishedStorageIdentity } from '@/lib/sidedoor/storage/migration/storage-publication';
import {
  assertAssessmentAudioUnclaimed,
  fenceAssessmentAudioTransition,
} from './assessment-audio-claim';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const bindingSchema = z
  .object({
    version: z.literal(1),
    operationId: z.uuid(),
    fingerprint: digest,
    classId: z.string().min(1),
    courseId: z.string().min(1),
    userId: z.string().min(1),
    classGeneration: z.number().int().nonnegative().safe(),
    scopes: z
      .array(
        z
          .object({
            subjectId: z.string().min(1),
            generation: z.number().int().nonnegative().safe(),
          })
          .strict()
      )
      .min(4)
      .max(100),
    assessmentId: z.string().min(1),
    parentOperationId: z.string().min(1),
    episodeId: z.string().min(1),
    segmentId: z.string().min(1),
    segmentVersion: z.number().int().positive(),
    generationKey: z.string().min(1),
    sourceDigest: digest,
  })
  .strict();
const stateSchema = z.discriminatedUnion('status', [
  bindingSchema.extend({ status: z.literal('ACTIVE') }).strict(),
  bindingSchema
    .extend({
      status: z.literal('COMPLETE'),
      dispatches: z.number().int().min(1).max(64),
      contentSha256: digest,
      contentBytes: z.number().int().positive(),
      reference: storageInputSchema,
    })
    .strict(),
]);
type Binding = z.infer<typeof bindingSchema>;
type Observation = Readonly<{ onDispatch: () => void; onSettled: () => void }>;
const observations = new WeakMap<
  Observation,
  {
    binding: Binding;
    dispatched: number;
    settled: number;
    outstanding: boolean;
    invalid: boolean;
    publishing: boolean;
    operation: SottoJobExecutionOperation;
  }
>();

function claimIdentity(binding: Binding) {
  return {
    classId: binding.classId,
    classGeneration: binding.classGeneration,
    assessmentId: binding.assessmentId,
    operationId: binding.operationId,
    fingerprint: binding.fingerprint,
  };
}

function attemptPrefix(classId: string, classGeneration: number) {
  const key = createHash('sha256')
    .update(JSON.stringify([classId, classGeneration]))
    .digest('hex');
  return `${SIDEDOOR_STATE_ID}:assessment-audio-attempt:${key}:`;
}

function backend(
  database: Prisma.TransactionClient,
  classId: string,
  classGeneration: number,
  operationId: string
) {
  return sqlStateBackend(
    { query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
    'postgres',
    `${attemptPrefix(classId, classGeneration)}${operationId}`
  );
}

async function capture(
  database: Prisma.TransactionClient,
  input: {
    episodeId: string;
    segmentId: string;
    generationKey: string;
    operationId: string;
    fingerprint?: string;
  },
  requirePending: boolean
) {
  await validateAssessmentAudioLineage(database, input.episodeId, input.generationKey);
  const episode = await database.episode.findUniqueOrThrow({
    where: { id: input.episodeId },
    include: { voices: true, segments: { orderBy: { order: 'asc' } } },
  });
  const segment = episode.segments.find((item) => item.id === input.segmentId);
  if (
    !segment ||
    segment.version !== 1 ||
    segment.ttsProvider !== null ||
    segment.ttsModel !== null ||
    segment.ttsVoiceId !== null ||
    !episode.assessmentAudioAssessmentId ||
    !episode.assessmentAudioOperationId ||
    !episode.ttsProvider ||
    !episode.ttsModel ||
    episode.audioGenerationKey !== input.generationKey
  )
    throw new AssessmentFenceConflict();
  const voice = episode.voices.find((item) => item.speaker === segment.speaker);
  if (!voice?.voiceId || voice.provider !== episode.ttsProvider)
    throw new AssessmentFenceConflict();
  const expectedId = durableQueueOperationId(
    'audio-generation',
    `audio-${episode.id}-${segment.id}-v${segment.version}-${input.generationKey}`
  );
  if (expectedId !== input.operationId) throw new AssessmentFenceConflict();
  const record = await sottoJobOutbox(database).read(expectedId);
  if (
    !record ||
    (requirePending && record.complete) ||
    record.job.handler !== 'audio-generation' ||
    record.job.version !== 1
  )
    throw new AssessmentFenceConflict();
  const envelope = durableEnvelopeSchema.parse(record.job.payload);
  const index = episode.segments.findIndex((item) => item.id === segment.id);
  const expectedPayload = {
    episodeId: episode.id,
    audioGenerationKey: input.generationKey,
    segmentId: segment.id,
    segmentVersion: segment.version,
    speaker: segment.speaker,
    text: segment.text,
    ...(index ? { previousText: episode.segments[index - 1]!.text.slice(-500) } : {}),
    ...(index < episode.segments.length - 1
      ? { nextText: episode.segments[index + 1]!.text.slice(0, 500) }
      : {}),
  };
  const storage = await captureEpisodeStorage(database, episode.id);
  const assessment = await database.classAssessment.findUniqueOrThrow({
    where: { id: episode.assessmentAudioAssessmentId },
    select: { classId: true, courseId: true, userId: true },
  });
  const classScope = storage.scopes.find(
    (item) => item.subjectId === `class:${assessment.classId}`
  );
  if (
    !classScope ||
    assessment.userId !== episode.userId ||
    storage.associations.assessmentSection?.assessmentId !== episode.assessmentAudioAssessmentId ||
    storage.associations.assessmentSection.classId !== assessment.classId
  )
    throw new AssessmentFenceConflict();
  if (
    envelope.type !== 'generate_audio' ||
    envelope.authority.kind !== 'episode' ||
    envelope.authority.episodeId !== episode.id ||
    envelope.authority.preparationAudioGenerationKey !== input.generationKey ||
    !isDeepStrictEqual(envelope.payload, expectedPayload) ||
    !isDeepStrictEqual(record.job.scopes, storage.scopes)
  )
    throw new AssessmentFenceConflict();
  await validateDurableAuthority(database, envelope.authority);
  const binding = bindingSchema.parse({
    version: 1,
    operationId: expectedId,
    fingerprint: record.fingerprint,
    classId: assessment.classId,
    courseId: assessment.courseId,
    userId: assessment.userId,
    classGeneration: classScope.generation,
    scopes: storage.scopes,
    assessmentId: episode.assessmentAudioAssessmentId,
    parentOperationId: episode.assessmentAudioOperationId,
    episodeId: episode.id,
    segmentId: segment.id,
    segmentVersion: segment.version,
    generationKey: input.generationKey,
    sourceDigest: learningProviderInputHash({
      payload: expectedPayload,
      storage,
      provider: episode.ttsProvider,
      model: episode.ttsModel,
      voice: { speaker: voice.speaker, provider: voice.provider, voiceId: voice.voiceId },
    }),
  });
  if (input.fingerprint && input.fingerprint !== binding.fingerprint)
    throw new AssessmentFenceConflict();
  return { binding, segment, storage, episodeStatus: episode.status };
}

/** An existing attempt never issues another dispatch capability, even after a crash. */
export async function beginAssessmentAudioAttempt(
  database: PrismaClient,
  input: {
    episodeId: string;
    segmentId: string;
    generationKey: string;
    operationId: string;
    fingerprint?: string;
  },
  operation?: SottoJobExecutionOperation
) {
  const immutable = structuredClone(input);
  if (!operation || !immutable.fingerprint) throw new AssessmentFenceConflict();
  const expected = { parentId: immutable.operationId, fingerprint: immutable.fingerprint };
  assertSottoExecutionOperation(operation, expected);
  const binding = await sottoTransaction(database, async (tx) => {
    const captured = await capture(tx, immutable, true);
    await verifySottoExecutionOperation(tx, operation, expected);
    if (captured.segment.audioUrl !== null) throw new AssessmentFenceConflict();
    await assertAssessmentAudioUnclaimed(tx, claimIdentity(captured.binding));
    await fenceAssessmentAudioTransition(tx, captured.binding.assessmentId);
    const store = backend(
      tx,
      captured.binding.classId,
      captured.binding.classGeneration,
      captured.binding.operationId
    );
    if (await store.read()) throw new AssessmentFenceConflict();
    if (
      !(await store.compareAndSwap(null, {
        revision: randomUUID(),
        state: { ...captured.binding, status: 'ACTIVE' },
      }))
    )
      throw new AssessmentFenceConflict();
    return captured.binding;
  });
  const state = {
    binding,
    dispatched: 0,
    settled: 0,
    outstanding: false,
    invalid: false,
    publishing: false,
    operation,
  };
  const observation: Observation = Object.freeze({
    onDispatch: () => {
      assertSottoExecutionOperation(operation, expected);
      if (state.invalid || state.publishing || state.outstanding || state.dispatched >= 64) {
        state.invalid = true;
        throw new AssessmentFenceConflict();
      }
      state.outstanding = true;
      state.dispatched += 1;
    },
    onSettled: () => {
      assertSottoExecutionOperation(operation, expected);
      if (state.invalid || state.publishing || !state.outstanding) {
        state.invalid = true;
        throw new AssessmentFenceConflict();
      }
      state.outstanding = false;
      state.settled += 1;
    },
  });
  observations.set(observation, state);
  return observation;
}

/** Own the exact bytes, storage write, segment update and attempt completion together. */
export async function publishAssessmentAudioAttempt(input: {
  database: PrismaClient;
  observation: Observation;
  audio: Uint8Array;
  duration: number;
  wordTimings: unknown;
  signal: AbortSignal;
}) {
  const { database, observation, signal } = input;
  const local = observations.get(observation);
  const bytes = Buffer.from(input.audio);
  const duration = input.duration;
  if (
    !local ||
    local.invalid ||
    local.publishing ||
    local.outstanding ||
    local.dispatched < 1 ||
    local.dispatched !== local.settled ||
    !bytes.length ||
    !Number.isFinite(duration) ||
    duration <= 0
  )
    throw new AssessmentFenceConflict();
  const timings =
    input.wordTimings === null ? null : z.json().parse(structuredClone(input.wordTimings));
  local.publishing = true;
  const { binding } = local;
  const dispatches = local.dispatched;
  const contentSha256 = createHash('sha256').update(bytes).digest('hex');
  const checkActive = async (tx: Prisma.TransactionClient) => {
    if (local.invalid) throw new AssessmentFenceConflict();
    const captured = await capture(tx, binding, true);
    await verifySottoExecutionOperation(tx, local.operation, {
      parentId: binding.operationId,
      fingerprint: binding.fingerprint,
    });
    await assertAssessmentAudioUnclaimed(tx, claimIdentity(binding));
    if (
      !isDeepStrictEqual(captured.binding, binding) ||
      captured.segment.audioUrl !== null ||
      captured.episodeStatus !== 'GENERATING_AUDIO'
    )
      throw new AssessmentFenceConflict();
    const store = backend(tx, binding.classId, binding.classGeneration, binding.operationId);
    const previous = await store.read();
    if (
      !previous ||
      !isDeepStrictEqual(stateSchema.parse(previous.state), { ...binding, status: 'ACTIVE' })
    )
      throw new AssessmentFenceConflict();
    return { captured, store, previous };
  };
  const writer = await captureSottoStorageWriter();
  return writeStorageReference({
    database,
    signal,
    writer,
    prefix: `episodes/${binding.episodeId}/segments`,
    extension: 'mp3',
    contentType: 'audio/mpeg',
    body: bytes,
    captureAdmission: async (tx) => {
      const { captured } = await checkActive(tx);
      return {
        ...captured.storage,
        consumer: `segment:${binding.segmentId}:audio`,
        snapshot: captured.storage,
      };
    },
    validateAdmission: async (tx, admission, committedReference) => {
      if (admission.consumer !== `segment:${binding.segmentId}:audio`)
        throw new AssessmentFenceConflict();
      if (!committedReference) {
        const { captured } = await checkActive(tx);
        if (!isDeepStrictEqual(captured.storage, admission.snapshot))
          throw new AssessmentFenceConflict();
        return;
      }
      const completed = await readCompletedAssessmentAudioAttempt(tx, binding);
      const captured = await capture(tx, binding, false);
      await verifySottoExecutionOperation(tx, local.operation, {
        parentId: binding.operationId,
        fingerprint: binding.fingerprint,
      });
      if (
        !isDeepStrictEqual(captured.storage, admission.snapshot) ||
        captured.segment.audioUrl !== committedReference ||
        completed.contentSha256 !== contentSha256 ||
        completed.contentBytes !== bytes.length
      )
        throw new AssessmentFenceConflict();
    },
    previousReference: () => null,
    commit: async (tx, audioUrl) => {
      const { store, previous } = await checkActive(tx);
      await fenceAssessmentAudioTransition(tx, binding.assessmentId);
      const updated = await tx.segment.updateMany({
        where: {
          id: binding.segmentId,
          episodeId: binding.episodeId,
          version: binding.segmentVersion,
          audioUrl: null,
        },
        data: { audioUrl, duration, ...(timings === null ? {} : { wordTimings: timings }) },
      });
      if (updated.count !== 1 || local.invalid) throw new AssessmentFenceConflict();
      const reference = (
        await resolveStorageInput(tx, {
          consumer: `segment:${binding.segmentId}:audio`,
          reference: audioUrl,
        })
      ).input;
      const next = stateSchema.parse({
        ...binding,
        status: 'COMPLETE',
        dispatches,
        contentSha256,
        contentBytes: bytes.length,
        reference,
      });
      if (local.invalid) throw new AssessmentFenceConflict();
      if (!(await store.compareAndSwap(previous.revision, { revision: randomUUID(), state: next })))
        throw new AssessmentFenceConflict();
    },
  });
}

/** Completed replay checks the exact owned segment and current attributed reference. */
export async function readCompletedAssessmentAudioAttempt(
  database: Prisma.TransactionClient,
  input: {
    episodeId: string;
    segmentId: string;
    generationKey: string;
    operationId: string;
  }
) {
  const captured = await capture(database, structuredClone(input), false);
  const stored = await backend(
    database,
    captured.binding.classId,
    captured.binding.classGeneration,
    input.operationId
  ).read();
  const state = stored && stateSchema.parse(stored.state);
  if (
    !state ||
    state.status !== 'COMPLETE' ||
    !captured.segment.audioUrl ||
    !isDeepStrictEqual(bindingSchema.strip().parse(state), captured.binding)
  )
    throw new AssessmentFenceConflict();
  const reference = (
    await resolveStorageInput(database, {
      consumer: `segment:${captured.segment.id}:audio`,
      reference: captured.segment.audioUrl,
    })
  ).input;
  if (!isDeepStrictEqual(reference, state.reference)) throw new AssessmentFenceConflict();
  return { contentSha256: state.contentSha256, contentBytes: state.contentBytes };
}

/** Inspect the exact admitted child before deciding whether dispatch is permitted. */
export async function readAssessmentAudioAttemptStatus(
  database: Prisma.TransactionClient,
  input: {
    episodeId: string;
    segmentId: string;
    generationKey: string;
    operationId: string;
    fingerprint: string;
  }
) {
  const immutable = structuredClone(input);
  const captured = await capture(database, immutable, false);
  if (captured.binding.fingerprint !== immutable.fingerprint) throw new AssessmentFenceConflict();
  await assertAssessmentAudioUnclaimed(database, claimIdentity(captured.binding));
  const stored = await backend(
    database,
    captured.binding.classId,
    captured.binding.classGeneration,
    immutable.operationId
  ).read();
  if (!stored) {
    if (captured.segment.audioUrl !== null) throw new AssessmentFenceConflict();
    return 'ABSENT' as const;
  }
  const state = stateSchema.parse(stored.state);
  if (!isDeepStrictEqual(bindingSchema.strip().parse(state), captured.binding))
    throw new AssessmentFenceConflict();
  if (state.status === 'ACTIVE') {
    if (captured.segment.audioUrl !== null) throw new AssessmentFenceConflict();
    return 'ACTIVE' as const;
  }
  await readCompletedAssessmentAudioAttempt(database, immutable);
  return 'COMPLETE' as const;
}

type RetainedAttempt = {
  classId: string;
  courseId: string;
  userId: string;
  classGeneration: number;
  scopes: readonly { subjectId: string; generation: number }[];
  assessmentId: string;
  parentOperationId: string;
  episodeId: string;
  segmentId: string;
  generationKey: string;
  operationId: string;
  fingerprint: string;
};

/** Read the original attempt during settlement without reopening provider authority. */
export async function readRetainedAssessmentAudioAttempt(
  database: Prisma.TransactionClient,
  input: RetainedAttempt
) {
  const expected = structuredClone(input);
  const stored = await backend(
    database,
    expected.classId,
    expected.classGeneration,
    expected.operationId
  ).read();
  if (!stored) return 'ABSENT' as const;
  const state = stateSchema.parse(stored.state);
  if (
    state.classId !== expected.classId ||
    state.courseId !== expected.courseId ||
    state.userId !== expected.userId ||
    state.classGeneration !== expected.classGeneration ||
    !isDeepStrictEqual(state.scopes, expected.scopes) ||
    state.assessmentId !== expected.assessmentId ||
    state.parentOperationId !== expected.parentOperationId ||
    state.episodeId !== expected.episodeId ||
    state.segmentId !== expected.segmentId ||
    state.generationKey !== expected.generationKey ||
    state.operationId !== expected.operationId ||
    state.fingerprint !== expected.fingerprint
  )
    throw new AssessmentFenceConflict();
  return state.status;
}

/** Verify the currently owned segment against the original atomic publication receipt. */
export async function verifyRetainedAssessmentAudioPublication(
  database: Prisma.TransactionClient,
  input: RetainedAttempt & { segmentVersion: number }
) {
  if ((await readRetainedAssessmentAudioAttempt(database, input)) !== 'COMPLETE')
    throw new AssessmentFenceConflict();
  const stored = await backend(
    database,
    input.classId,
    input.classGeneration,
    input.operationId
  ).read();
  const state = stored && stateSchema.parse(stored.state);
  if (
    !state ||
    state.status !== 'COMPLETE' ||
    state.segmentVersion !== input.segmentVersion ||
    state.reference.consumer !== `segment:${input.segmentId}:audio`
  )
    throw new AssessmentFenceConflict();
  const segment = await database.segment.findUnique({
    where: { id: input.segmentId },
    select: { episodeId: true, version: true, audioUrl: true },
  });
  if (
    !segment ||
    segment.episodeId !== input.episodeId ||
    segment.version !== input.segmentVersion ||
    !segment.audioUrl
  )
    throw new AssessmentFenceConflict();
  if (segment.audioUrl !== state.reference.reference) {
    const proof = await resolveOwnedClassStorage(database, {
      classId: input.classId,
      courseId: input.courseId,
      userId: input.userId,
      episodeId: input.episodeId,
      original: state.reference,
      currentReference: segment.audioUrl,
    });
    if (
      !matchesPublishedStorageIdentity(proof, {
        original: state.reference,
        currentReference: segment.audioUrl,
        contentSha256: state.contentSha256,
        contentBytes: state.contentBytes,
      })
    )
      throw new AssessmentFenceConflict();
    return { contentSha256: state.contentSha256, contentBytes: state.contentBytes };
  }
  const reference = (
    await resolveStorageInput(database, {
      consumer: `segment:${input.segmentId}:audio`,
      reference: state.reference.reference,
    })
  ).input;
  if (!isDeepStrictEqual(reference, state.reference)) throw new AssessmentFenceConflict();
  return { contentSha256: state.contentSha256, contentBytes: state.contentBytes };
}

/** Discover retained attempts under the class lock. Deletion must separately validate every record. */
export async function listAssessmentAudioAttempts(
  database: Prisma.TransactionClient,
  input: { classId: string; courseId: string; userId: string }
) {
  const expected = structuredClone(input);
  await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${expected.classId} FOR UPDATE`;
  const ownership = await capturePrerequisiteOwnership(
    database,
    expected.classId,
    expected.courseId,
    expected.userId
  );
  const scope = ownership.scopes.find((item) => item.subjectId === `class:${expected.classId}`);
  if (!scope) throw new AssessmentFenceConflict();
  const prefix = attemptPrefix(expected.classId, scope.generation);
  const attempts: Array<{
    stateId: string;
    revision: string;
    operationId: string;
    fingerprint: string;
    assessmentId: string;
    parentOperationId: string;
    episodeId: string;
    segmentId: string;
    segmentVersion: number;
    generationKey: string;
    sourceDigest: string;
    status: 'ACTIVE' | 'COMPLETE';
  }> = [];
  let after: string | undefined;
  while (true) {
    const rows = await database.sidedoorState.findMany({
      where: { id: { startsWith: prefix, ...(after ? { gt: after } : {}) } },
      orderBy: { id: 'asc' },
      take: 100,
    });
    for (const row of rows) {
      if (attempts.length >= 2000) throw new AssessmentFenceConflict();
      const state = stateSchema.parse(row.state);
      if (
        row.id !== `${prefix}${state.operationId}` ||
        state.classId !== expected.classId ||
        state.courseId !== expected.courseId ||
        state.userId !== expected.userId ||
        state.classGeneration !== scope.generation ||
        !ownership.scopes.every((item) =>
          state.scopes.some((stored) => isDeepStrictEqual(stored, item))
        ) ||
        new Set(state.scopes.map((item) => item.subjectId)).size !== state.scopes.length
      )
        throw new AssessmentFenceConflict();
      attempts.push({
        stateId: row.id,
        revision: row.revision,
        operationId: state.operationId,
        fingerprint: state.fingerprint,
        assessmentId: state.assessmentId,
        parentOperationId: state.parentOperationId,
        episodeId: state.episodeId,
        segmentId: state.segmentId,
        segmentVersion: state.segmentVersion,
        generationKey: state.generationKey,
        sourceDigest: state.sourceDigest,
        status: state.status,
      });
    }
    if (rows.length < 100) return attempts;
    const next = rows[rows.length - 1]!.id;
    if (after && next <= after) throw new AssessmentFenceConflict();
    after = next;
  }
}
