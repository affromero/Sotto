import { prismaUnfiltered as prisma } from './prisma';
import { logger } from './logger';
import { invalidatePodcastCache, publishPodcastStatus } from './redis';

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
 * Mark a podcast as FAILED, recording the status it was in when the failure occurred.
 * Idempotent: skips if the podcast is already FAILED.
 * Returns true if the status was actually changed, false if skipped.
 */
export async function markPodcastFailed(
  podcastId: string,
  options?: string | MarkFailedOptions,
): Promise<boolean> {
  const opts: MarkFailedOptions =
    typeof options === 'string' ? { failureReason: options } : options ?? {};

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { status: true },
  });

  if (!podcast || podcast.status === 'READY' || podcast.status === 'FAILED' || podcast.status === 'SCRIPT_READY') {
    return false;
  }

  // CAS status transition — prevents concurrent workers from double-marking
  const cas = await prisma.podcast.updateMany({
    where: { id: podcastId, status: podcast.status },
    data: {
      status: 'FAILED',
      failedAtStatus: podcast.status,
      failureReason: opts.failureReason ?? null,
      technicalError: opts.technicalError ?? null,
      errorId: opts.errorId ?? null,
      failedAt: new Date(),
    },
  });

  if (cas.count === 0) {
    logger.info('markPodcastFailed: status already changed, skipping', { podcastId });
    return false;
  }

  await invalidatePodcastCache(podcastId);
  await publishPodcastStatus(podcastId, { status: 'FAILED' });

  logger.info('Marked podcast as FAILED', {
    podcastId,
    failedAtStatus: podcast.status,
    failureReason: opts.failureReason,
  });

  return true;
}

/**
 * Inspect existing data and determine where the pipeline should resume from.
 * Checks from the end of the pipeline backward to preserve the most work.
 */
export async function determineResumePoint(podcastId: string): Promise<ResumePoint> {
  await prisma.podcast.findUniqueOrThrow({
    where: { id: podcastId },
    select: { id: true },
  });

  const [discovery, script, segments, dossier, outline] = await Promise.all([
    prisma.discovery.findUnique({
      where: { podcastId },
      select: { sourceContent: true },
    }),
    prisma.script.findUnique({
      where: { podcastId },
      select: { turns: true },
    }),
    prisma.segment.findMany({
      where: { podcastId },
      select: { id: true, audioUrl: true },
    }),
    prisma.researchDossier.findUnique({
      where: { podcastId },
      select: { id: true },
    }),
    prisma.creativeOutline.findUnique({
      where: { podcastId },
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
