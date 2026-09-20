import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@/generated/prisma/client';
import { AccessError } from 'thesidedoor-core/access';
import { captureEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import { resolveStorageInput } from '@/lib/sidedoor/storage/core/storage-inputs';
import type { CredentialExecutionAuthority } from '@/lib/sidedoor/credentials/runtime/credential-execution';
import { normalizeCompletedStitchStorage } from '@/lib/sidedoor/jobs/initial/initial-stitch-relocation';

/** The caller supplies the original request or generation-job authority in this transaction. */
async function captureInitialStitchState(
  database: Prisma.TransactionClient,
  authorize: CredentialExecutionAuthority,
  episodeId: string,
  generationKey: string,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  if (!generationKey.trim())
    throw new AccessError('invalid', 'An audio generation key is required');
  const identity = await authorize(database);
  const storage = await captureEpisodeStorage(database, episodeId);
  if (storage.userId !== identity.userId)
    throw new AccessError('forbidden', 'The stitching owner changed');
  const episode = await database.episode.findUniqueOrThrow({
    where: { id: episodeId },
    select: {
      id: true,
      audioGenerationKey: true,
      status: true,
      title: true,
      source: true,
      audioUrl: true,
      currentVersion: true,
      lastCompletedStitchKey: true,
      discovery: { select: { durationTarget: true } },
      script: { select: { soundCues: true, turns: true } },
      segments: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          version: true,
          order: true,
          text: true,
          speaker: true,
          audioUrl: true,
          duration: true,
          ttsVoiceId: true,
          wordTimings: true,
        },
      },
    },
  });
  if (episode.audioGenerationKey !== generationKey)
    throw new AccessError('conflict', 'The audio generation changed');
  if (!episode.segments.length || episode.segments.some((segment) => !segment.audioUrl))
    throw new AccessError('conflict', 'All segments must have audio before stitching');
  const storageInputs = [];
  for (const segment of episode.segments) {
    signal?.throwIfAborted();
    const resolved = await resolveStorageInput(database, {
      consumer: `segment:${segment.id}:audio`,
      reference: segment.audioUrl!,
    });
    storageInputs.push(resolved.input);
  }
  signal?.throwIfAborted();
  const inputs = {
    episodeId,
    generationKey,
    storage,
    title: episode.title,
    source: episode.source,
    previousAudio: {
      audioUrl: episode.audioUrl,
      currentVersion: episode.currentVersion,
      lastCompletedStitchKey: episode.lastCompletedStitchKey,
    },
    durationTarget: episode.discovery?.durationTarget ?? null,
    script: episode.script,
    segments: episode.segments,
    storageInputs,
  };
  return { inputs, phase: episode.status };
}

export async function captureInitialStitchInputs(
  database: Prisma.TransactionClient,
  authorize: CredentialExecutionAuthority,
  episodeId: string,
  generationKey: string,
  signal?: AbortSignal
) {
  const current = await captureInitialStitchState(
    database,
    authorize,
    episodeId,
    generationKey,
    signal
  );
  if (!['GENERATING_AUDIO', 'STITCHING', 'FAILED'].includes(current.phase))
    throw new AccessError('conflict', 'The audio generation changed');
  return current.inputs;
}

export type InitialStitchInputs = Awaited<ReturnType<typeof captureInitialStitchInputs>>;

/** Reuse before side effects and in the final publication transaction. */
export async function validateInitialStitchInputs(
  database: Prisma.TransactionClient,
  authorize: CredentialExecutionAuthority,
  expected: InitialStitchInputs,
  requiredPhase: 'GENERATING_AUDIO' | 'STITCHING' | 'FAILED',
  signal?: AbortSignal
) {
  const captured = structuredClone(expected);
  const current = await captureInitialStitchState(
    database,
    authorize,
    captured.episodeId,
    captured.generationKey,
    signal
  );
  signal?.throwIfAborted();
  if (current.phase !== requiredPhase)
    throw new AccessError('conflict', 'The stitching phase changed');
  if (!isDeepStrictEqual(current.inputs, captured))
    throw new AccessError('conflict', 'The captured stitching inputs changed');
}

/** A completed replay may read READY state, but never admits a new stitch from it. */
export async function validateCompletedInitialStitchInputs(
  database: Prisma.TransactionClient,
  authorize: CredentialExecutionAuthority,
  expected: InitialStitchInputs,
  publishedAudio: InitialStitchInputs['previousAudio'],
  requiredPhase: 'READY' | 'FAILED',
  signal?: AbortSignal
) {
  const captured = structuredClone({ ...expected, previousAudio: publishedAudio });
  const current = await captureInitialStitchState(
    database,
    authorize,
    captured.episodeId,
    captured.generationKey,
    signal
  );
  const comparable = await normalizeCompletedStitchStorage(
    database,
    current.inputs,
    captured,
    signal
  );
  if (current.phase !== requiredPhase || !isDeepStrictEqual(comparable, captured))
    throw new AccessError('conflict', 'The completed stitching result was superseded');
}
