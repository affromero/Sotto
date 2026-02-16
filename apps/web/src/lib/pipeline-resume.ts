import { prisma } from './prisma';
import { logger } from './logger';
import { cancelPodcastPayments } from './voice-pricing';

/**
 * Discriminated union of pipeline resume points.
 * Each step indicates where the pipeline should restart from.
 */
export type ResumePoint =
  | { step: 'EXTRACT_CONTENT' }
  | { step: 'GENERATE_SCRIPT' }
  | { step: 'VERIFY_SCRIPT' }
  | { step: 'VALIDATE_REFERENCES' }
  | { step: 'SCRIPT_READY' }
  | { step: 'GENERATE_AUDIO'; pendingSegmentIds: string[] }
  | { step: 'STITCH_AUDIO'; segmentIds: string[] }
  | { step: 'IMPORT_AUDIO' };

/**
 * Mark a podcast as FAILED, recording the status it was in when the failure occurred.
 * Idempotent: skips if the podcast is already FAILED.
 */
export async function markPodcastFailed(podcastId: string, failureReason?: string): Promise<void> {
  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { status: true },
  });

  if (!podcast || podcast.status === 'READY' || podcast.status === 'FAILED' || podcast.status === 'SCRIPT_READY') {
    return;
  }

  await prisma.podcast.update({
    where: { id: podcastId },
    data: {
      status: 'FAILED',
      failedAtStatus: podcast.status,
      failureReason: failureReason ?? null,
    },
  });

  // Cancel any authorized voice payments for this podcast
  await cancelPodcastPayments(podcastId).catch((err) => {
    logger.error('Failed to cancel voice payments on failure', {
      podcastId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  logger.info('Marked podcast as FAILED', { podcastId, failedAtStatus: podcast.status, failureReason });
}

/**
 * Inspect existing data and determine where the pipeline should resume from.
 * Checks from the end of the pipeline backward to preserve the most work.
 */
export async function determineResumePoint(podcastId: string): Promise<ResumePoint> {
  const [podcast, discovery, script, references, segments] = await Promise.all([
    prisma.podcast.findUniqueOrThrow({
      where: { id: podcastId },
      select: { source: true, failedAtStatus: true, importedAudioKey: true },
    }),
    prisma.discovery.findUnique({
      where: { podcastId },
      select: { sourceContent: true },
    }),
    prisma.script.findUnique({
      where: { podcastId },
      select: {
        turns: true,
        verificationAttempts: true,
      },
    }),
    prisma.reference.findMany({
      where: { podcastId },
      select: { id: true, verificationStatus: true },
    }),
    prisma.segment.findMany({
      where: { podcastId },
      select: { id: true, audioUrl: true },
    }),
  ]);

  // 1. Import source → let the import worker handle its own idempotency
  if (podcast.source === 'IMPORT' && podcast.importedAudioKey) {
    return { step: 'IMPORT_AUDIO' };
  }

  // 2. All segments have audioUrl → just need to stitch
  if (segments.length > 0 && segments.every((s) => s.audioUrl !== null)) {
    return { step: 'STITCH_AUDIO', segmentIds: segments.map((s) => s.id) };
  }

  // 3. Some segments exist, some lack audioUrl
  if (segments.length > 0 && segments.some((s) => s.audioUrl === null)) {
    // Verify segment count matches script turns
    const scriptTurnCount = script ? (script.turns as unknown[]).length : 0;
    if (script && segments.length === scriptTurnCount) {
      // Segments match script — resume audio generation for pending segments only
      const pendingSegmentIds = segments
        .filter((s) => s.audioUrl === null)
        .map((s) => s.id);
      return { step: 'GENERATE_AUDIO', pendingSegmentIds };
    }
    // Segment count mismatch — stale segments, go back to SCRIPT_READY
    return { step: 'SCRIPT_READY' };
  }

  // At this point: no segments exist
  if (script) {
    const hasValidatedRefs = references.some((r) => r.verificationStatus !== 'PENDING');

    // 4. Script exists + some refs have been validated → refs were being processed
    if (hasValidatedRefs) {
      const allRefsValidated = references.every((r) => r.verificationStatus !== 'PENDING');
      if (allRefsValidated) {
        return { step: 'SCRIPT_READY' };
      }
      return { step: 'VALIDATE_REFERENCES' };
    }

    // 5. Script failed verification 3x with NO validated refs and no segments
    //    → bad script, delete and regenerate
    //    Note: checked AFTER step 4 so scripts that passed on the 3rd attempt
    //    (and have validated refs) are preserved
    if (script.verificationAttempts >= 3 && !hasValidatedRefs) {
      return { step: 'GENERATE_SCRIPT' };
    }

    // 6. Script exists, never verified
    if (script.verificationAttempts === 0) {
      return { step: 'VERIFY_SCRIPT' };
    }

    // 7. Script exists, mid-verification (1-2 attempts), all refs still PENDING
    if (script.verificationAttempts > 0 && script.verificationAttempts < 3) {
      return { step: 'VERIFY_SCRIPT' };
    }
  }

  // 8. Discovery has sourceContent but no script
  if (discovery?.sourceContent) {
    return { step: 'GENERATE_SCRIPT' };
  }

  // 9. Nothing exists → start from scratch
  return { step: 'EXTRACT_CONTENT' };
}
