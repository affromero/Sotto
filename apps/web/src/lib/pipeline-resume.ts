import { prismaUnfiltered as prisma } from './prisma';
import { logger } from './logger';
import { invalidateEpisodeCache, publishEpisodeStatus } from './redis';

/**
 * Discriminated union of pipeline resume points.
 * Each step indicates where the pipeline should restart from.
 */
export type ResumePoint =
  | { step: 'EXTRACT_CONTENT' }
  | { step: 'DEEP_RESEARCH' }
  | { step: 'CREATIVE_PLANNING' }
  | { step: 'WRITE_SCRIPT' }
  | { step: 'COMPILE_SCRIPT' }
  | { step: 'SCRIPT_READY' }
  | { step: 'GENERATE_AUDIO'; pendingSegmentIds: string[] }
  | { step: 'STITCH_AUDIO'; segmentIds: string[] };

interface MarkFailedOptions {
  failureReason?: string;
  technicalError?: string;
  errorId?: string;
}

/**
 * Mark a episode as FAILED, recording the status it was in when the failure occurred.
 * Idempotent: skips if the episode is already FAILED.
 * Returns true if the status was actually changed, false if skipped.
 */
export async function markEpisodeFailed(
  episodeId: string,
  options?: string | MarkFailedOptions,
): Promise<boolean> {
  const opts: MarkFailedOptions =
    typeof options === 'string' ? { failureReason: options } : options ?? {};

  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: { status: true },
  });

  if (!episode || episode.status === 'READY' || episode.status === 'FAILED' || episode.status === 'SCRIPT_READY') {
    return false;
  }

  // CAS status transition — prevents concurrent workers from double-marking
  const cas = await prisma.episode.updateMany({
    where: { id: episodeId, status: episode.status },
    data: {
      status: 'FAILED',
      failedAtStatus: episode.status,
      failureReason: opts.failureReason ?? null,
      technicalError: opts.technicalError ?? null,
      errorId: opts.errorId ?? null,
      failedAt: new Date(),
    },
  });

  if (cas.count === 0) {
    logger.info('markEpisodeFailed: status already changed, skipping', { episodeId });
    return false;
  }

  await invalidateEpisodeCache(episodeId);
  await publishEpisodeStatus(episodeId, { status: 'FAILED' });

  logger.info('Marked episode as FAILED', {
    episodeId,
    failedAtStatus: episode.status,
    failureReason: opts.failureReason,
  });

  return true;
}

/**
 * Inspect existing data and determine where the pipeline should resume from.
 * Checks from the end of the pipeline backward to preserve the most work.
 */
export async function determineResumePoint(episodeId: string): Promise<ResumePoint> {
  await prisma.episode.findUniqueOrThrow({
    where: { id: episodeId },
    select: { id: true },
  });

  const [discovery, script, segments, dossier, outline] = await Promise.all([
    prisma.discovery.findUnique({
      where: { episodeId },
      select: { sourceContent: true },
    }),
    prisma.script.findUnique({
      where: { episodeId },
      select: { turns: true },
    }),
    prisma.segment.findMany({
      where: { episodeId },
      select: { id: true, audioUrl: true },
    }),
    prisma.researchDossier.findUnique({
      where: { episodeId },
      select: { id: true },
    }),
    prisma.creativeOutline.findUnique({
      where: { episodeId },
      select: { id: true },
    }),
  ]);

  // 1. All segments have audioUrl → just need to stitch
  if (segments.length > 0 && segments.every((s) => s.audioUrl !== null)) {
    return { step: 'STITCH_AUDIO', segmentIds: segments.map((s) => s.id) };
  }

  // 2. Some segments exist, some lack audioUrl
  if (segments.length > 0 && segments.some((s) => s.audioUrl === null)) {
    const scriptTurnCount = script ? (script.turns as unknown[]).length : 0;
    if (script && segments.length === scriptTurnCount) {
      const pendingSegmentIds = segments
        .filter((s) => s.audioUrl === null)
        .map((s) => s.id);
      return { step: 'GENERATE_AUDIO', pendingSegmentIds };
    }
    return { step: 'SCRIPT_READY' };
  }

  // 3. Script exists → compile step
  if (script) {
    return { step: 'COMPILE_SCRIPT' };
  }

  // 4. Outline exists but no script → write script
  if (outline) {
    return { step: 'WRITE_SCRIPT' };
  }

  // 5. Dossier exists but no outline → creative planning
  if (dossier) {
    return { step: 'CREATIVE_PLANNING' };
  }

  // 6. Discovery has sourceContent but no dossier → research
  if (discovery?.sourceContent) {
    return { step: 'DEEP_RESEARCH' };
  }

  // 7. Nothing exists → start from scratch
  return { step: 'EXTRACT_CONTENT' };
}
