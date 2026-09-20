import { isDeepStrictEqual } from 'node:util';
import type { Job } from 'bullmq';
import { AccessError } from 'thesidedoor-core/access';
import type { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { createInitialStitchKey } from '@/lib/audio/stitch-identity';
import {
  validateStitchSoundScript,
  type StitchSoundExecution,
} from '@/lib/audio/stitch-sound-effects';
import { initialStitchPayloadSchema } from '@/lib/sidedoor/jobs/initial/initial-stitch-contract';
import { readSottoWorkerJob } from '@/lib/sidedoor/jobs/core/job-delivery';
import { completeErasedJob } from '@/lib/sidedoor/access/deletion/job-erasure';
import { requireInitialStitchAttempt } from '@/lib/sidedoor/jobs/initial/initial-stitch-admission';
import { validateInitialStitchInputs } from '@/lib/sidedoor/jobs/initial/initial-stitch-inputs';
import { validateEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import { validateStorageInputs } from '@/lib/sidedoor/storage/core/storage-inputs';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  captureSottoExecutionCredential,
  validateSottoExecutionCredential,
  type SottoExecutionCredential,
} from '@/lib/sidedoor/credentials/runtime/credential-execution';
import { createTtsProviderAsync } from '@/lib/providers/tts';
import { runDurableStitching } from '@/workers/durable/audio/durable-stitching-runner';

type Queued = { id?: string; name: string; data: unknown };
async function readWork(database: Prisma.TransactionClient, queued: Queued, signal: AbortSignal) {
  signal.throwIfAborted();
  const work = await readSottoWorkerJob(database, queued, {
    handler: 'audio-stitching',
    version: 2,
    payload: initialStitchPayloadSchema,
  });
  if (work.complete) return work;
  const { inputs } = work.payload;
  if (!isDeepStrictEqual(work.scopes, inputs.storage.scopes))
    throw new AccessError('conflict', 'Initial stitching scopes changed');
  if (await completeErasedJob(database, work)) return { complete: true as const };
  await requireInitialStitchAttempt(database, inputs.episodeId, work.operationId, work.fingerprint);
  await validateInitialStitchInputs(
    database,
    async (tx) => {
      await validateEpisodeStorage(tx, inputs.episodeId, inputs.storage);
      return { userId: inputs.storage.userId };
    },
    inputs,
    'STITCHING',
    signal
  );
  const backends = await validateStorageInputs(database, inputs.storageInputs);
  return { ...work, backends };
}

/** Initial-generation jobs retain their admitted inputs, output IDs and explicit sound policy. */
export async function processDurableInitialAudioStitching(
  job: Pick<Job<unknown>, 'id' | 'name' | 'data' | 'updateProgress'>,
  signal: AbortSignal = new AbortController().signal
): Promise<void> {
  const queued = structuredClone({ id: job.id, name: job.name, data: job.data });
  const captured = await sottoTransaction(prisma, (tx) => readWork(tx, queued, signal), { signal });
  if (captured.complete) {
    await job.updateProgress(100);
    return;
  }
  const { inputs, soundPolicy, outputs } = captured.payload;
  const authorize = async (database: Prisma.TransactionClient) => {
    const current = await readWork(database, queued, signal);
    if (current.complete || !isDeepStrictEqual(current.payload, captured.payload))
      throw new AccessError('conflict', 'The initial stitching generation changed');
    return { userId: inputs.storage.userId };
  };
  let sound: StitchSoundExecution = { policy: 'none' };
  let soundCredential: SottoExecutionCredential | null = null;
  const script = soundPolicy === 'none' ? null : validateStitchSoundScript(inputs.script);
  if (soundPolicy !== 'none') {
    sound = { policy: 'stock', script: inputs.script };
  }
  if (soundPolicy === 'elevenlabs' && script!.cues.length > 0) {
    const credential = await sottoTransaction(
      prisma,
      (tx) => captureSottoExecutionCredential(tx, authorize, 'tts', 'elevenlabs', true, signal),
      { signal }
    );
    soundCredential = credential;
    const provider = await createTtsProviderAsync('elevenlabs', {
      userId: inputs.storage.userId,
      authorize,
      credential,
      signal,
    });
    if (!provider.generateSoundEffect)
      throw new Error('The selected provider cannot generate sound effects');
    const generate = provider.generateSoundEffect.bind(provider);
    sound = { policy: 'elevenlabs', script: inputs.script, generate };
  }
  await runDurableStitching({
    work: {
      kind: 'initial',
      operationId: captured.operationId,
      fingerprint: captured.fingerprint,
      scopes: captured.scopes,
      backends: captured.backends,
      episode: {
        id: inputs.episodeId,
        userId: inputs.storage.userId,
        title: inputs.title,
        audioUrl: inputs.previousAudio.audioUrl,
        currentVersion: inputs.previousAudio.currentVersion,
        discovery: { durationTarget: inputs.durationTarget },
        segments: inputs.segments,
      },
      payload: {
        storage: inputs.storage,
        storageInputs: inputs.storageInputs,
        contributorId: inputs.storage.userId,
      },
    },
    job,
    outputs,
    sound,
    signal,
    stitchKey: createInitialStitchKey(captured.fingerprint),
    changeType: inputs.previousAudio.audioUrl ? 'regeneration' : 'initial',
    interactionId: null,
    validatePending: async (tx) => {
      const current = await readWork(tx, queued, signal);
      if (current.complete) return false;
      if (!isDeepStrictEqual(current.payload, captured.payload))
        throw new AccessError('conflict', 'The initial stitching admission changed');
      if (soundCredential)
        await validateSottoExecutionCredential(tx, authorize, soundCredential, signal);
      return true;
    },
    validateAttempt: async (tx) => {
      await requireInitialStitchAttempt(
        tx,
        inputs.episodeId,
        captured.operationId,
        captured.fingerprint
      );
      await validateEpisodeStorage(tx, inputs.episodeId, inputs.storage);
      const episode = await tx.episode.findUniqueOrThrow({
        where: { id: inputs.episodeId },
        select: { audioGenerationKey: true },
      });
      if (episode.audioGenerationKey !== inputs.generationKey)
        throw new AccessError('conflict', 'The completed initial stitching generation changed');
    },
  });
}
