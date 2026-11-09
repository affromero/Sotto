import { isDeepStrictEqual } from 'node:util';
import { JobErasedError } from 'thesidedoor-core/runtime/outbox';
import type { Prisma } from '@/generated/prisma/client';
import { captureEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import {
  durableEnvelopeSchema,
  durableQueueOperationId,
  validateDurableAuthority,
} from '@/lib/sidedoor/jobs/core/durable-queue';
import { verifyCurrentInitialStitch } from '@/lib/sidedoor/jobs/initial/initial-stitch-admission';
import { readInitialStitchOutcome } from '@/lib/sidedoor/jobs/initial/initial-stitch-outcome';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { validateAssessmentAudioLineage } from './assessment-audio-lineage';
import { readCompletedAssessmentAudioAttempt } from './assessment-audio-attempt';
import { AssessmentFenceConflict } from '../lifecycle/assessment-fence';
import { requirePendingAssessmentWork } from '../generation/assessment-work';

/** Prove tracked workers drained and every segment has its owned publication receipt. */
export async function verifyAssessmentAudioJobsDrained(
  database: Prisma.TransactionClient,
  identity: { id: string; fingerprint: string },
  execution: SottoProviderExecution
) {
  const { current } = await requirePendingAssessmentWork(database, identity, execution, 'RUNNING');
  if (current.requirements.skills.LISTENING.state !== 'REQUIRED')
    return { status: 'DRAINED' as const };
  await database.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${current.assessmentId} FOR UPDATE`;
  const section = await database.classAssessmentSection.findUniqueOrThrow({
    where: { assessmentId_skill: { assessmentId: current.assessmentId, skill: 'LISTENING' } },
    include: { episode: { include: { segments: { orderBy: { order: 'asc' } } } } },
  });
  const episode = section.episode;
  if (!episode || !section.episodeId) throw new AssessmentFenceConflict();
  await database.$queryRaw`SELECT id FROM "Episode" WHERE id = ${episode.id} FOR UPDATE`;
  const generationKey = durableQueueOperationId('assessment-audio', `${identity.id}:${episode.id}`);
  if (episode.audioGenerationKey !== generationKey) throw new AssessmentFenceConflict();
  if (!['GENERATING_AUDIO', 'STITCHING', 'READY'].includes(episode.status))
    throw new AssessmentFenceConflict();
  await validateAssessmentAudioLineage(database, episode.id, generationKey);
  if (episode.status !== 'READY') return { status: 'WAITING' as const };
  if (
    !section.audioIdentity ||
    !episode.segments.length ||
    episode.segments.some((item) => !item.audioUrl || item.version !== 1)
  )
    throw new AssessmentFenceConflict();
  const ownership = await captureEpisodeStorage(database, episode.id);
  const scope = ownership.scopes.find((item) => item.subjectId === `episode:${episode.id}`);
  if (!scope) throw new AssessmentFenceConflict();
  const expected = new Map(
    episode.segments.map((segment, index) => [
      durableQueueOperationId(
        'audio-generation',
        `audio-${episode.id}-${segment.id}-v${segment.version}-${generationKey}`
      ),
      {
        episodeId: episode.id,
        audioGenerationKey: generationKey,
        segmentId: segment.id,
        segmentVersion: segment.version,
        speaker: segment.speaker,
        text: segment.text,
        ...(index ? { previousText: episode.segments[index - 1]!.text.slice(-500) } : {}),
        ...(index < episode.segments.length - 1
          ? { nextText: episode.segments[index + 1]!.text.slice(0, 500) }
          : {}),
      },
    ])
  );
  const stitch = await verifyCurrentInitialStitch(
    database,
    execution.authorize,
    episode.id,
    generationKey,
    execution.signal
  );
  if (
    !stitch.record.complete ||
    (await readInitialStitchOutcome(database, stitch.record)).kind !== 'READY'
  )
    throw new AssessmentFenceConflict();
  if (!['none', 'stock'].includes(stitch.payload.soundPolicy)) throw new AssessmentFenceConflict();
  const outbox = sottoJobOutbox(database);
  const executions = sottoJobExecutions(database);
  const seen = new Set<string>();
  let stitchSeen = false;
  let waiting = false;
  let cursor: string | null = null;
  let count = 0;
  do {
    const page = await outbox.listForScope(scope.subjectId, scope.generation, cursor);
    for (const reference of page.jobs) {
      if (++count > 2000) throw new AssessmentFenceConflict();
      let record;
      try {
        record = await outbox.read(reference.id);
      } catch (error) {
        if (
          error instanceof JobErasedError &&
          ['audio-generation', 'audio-stitching'].includes(error.receipt.handler)
        )
          throw new AssessmentFenceConflict();
        if (error instanceof JobErasedError) continue;
        throw error;
      }
      if (!record || record.fingerprint !== reference.fingerprint)
        throw new AssessmentFenceConflict();
      if (record.job.handler === 'audio-stitching') {
        if (
          record.job.id !== stitch.record.job.id ||
          record.fingerprint !== stitch.record.fingerprint ||
          stitchSeen
        )
          throw new AssessmentFenceConflict();
        stitchSeen = true;
      } else if (record.job.handler === 'audio-generation') {
        const envelope = durableEnvelopeSchema.parse(record.job.payload);
        const payload = expected.get(record.job.id);
        if (
          !payload ||
          seen.has(record.job.id) ||
          record.job.version !== 1 ||
          envelope.type !== 'generate_audio' ||
          envelope.authority.kind !== 'episode' ||
          envelope.authority.episodeId !== episode.id ||
          envelope.authority.preparationAudioGenerationKey !== generationKey ||
          !isDeepStrictEqual(envelope.payload, payload) ||
          !isDeepStrictEqual(record.job.scopes, ownership.scopes)
        )
          throw new AssessmentFenceConflict();
        await validateDurableAuthority(database, envelope.authority);
        await readCompletedAssessmentAudioAttempt(database, {
          episodeId: episode.id,
          segmentId: payload.segmentId,
          generationKey,
          operationId: record.job.id,
        });
        seen.add(record.job.id);
      } else continue;
      if (!record.complete || (await executions.blockingStatus(record.job.id, record.fingerprint)))
        waiting = true;
      else await executions.requireParentDrained(record.job.id, record.fingerprint);
    }
    cursor = page.cursor;
  } while (cursor);
  if (!stitchSeen || seen.size !== expected.size) throw new AssessmentFenceConflict();
  return { status: waiting ? ('WAITING' as const) : ('DRAINED' as const) };
}
