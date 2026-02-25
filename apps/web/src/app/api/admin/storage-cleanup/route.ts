import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { listFiles, deleteFile } from '@/lib/r2';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { errorResponse } from '@/lib/api-response';

/**
 * POST /api/admin/storage-cleanup — One-time cleanup of orphaned R2 storage
 *
 * Deletes:
 * 1. All intermediate segment audio files under podcasts/{id}/segments/
 * 2. Imported source files where the podcast is already READY
 */
export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return errorResponse('Unauthorized', 401);
  }
  if (session.user.role !== 'ADMIN') {
    return errorResponse('Admin access required', 403);
  }

  let segmentsDeleted = 0;
  let importsDeleted = 0;

  // 1. Delete all intermediate segment files
  const segmentKeys = await listFiles('podcasts/');
  const segmentFileKeys = segmentKeys.filter((key) =>
    /^podcasts\/[^/]+\/segments\/[^/]+\.mp3$/.test(key)
  );

  for (const key of segmentFileKeys) {
    await deleteFile(key).catch((err) => {
      logger.warn('Failed to delete segment file', {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    segmentsDeleted++;
  }

  // 2. Delete imported source files for READY podcasts
  const importKeys = await listFiles('imports/');

  for (const key of importKeys) {
    const podcast = await prisma.podcast.findFirst({
      where: { importedAudioKey: key },
      select: { status: true },
    });

    if (podcast?.status === 'READY') {
      await deleteFile(key).catch((err) => {
        logger.warn('Failed to delete import file', {
          key,
          error: err instanceof Error ? err.message : String(err),
        });
      });
      importsDeleted++;
    }
  }

  logger.info('Storage cleanup complete', {
    segmentsDeleted: String(segmentsDeleted),
    importsDeleted: String(importsDeleted),
  });

  return NextResponse.json({ segmentsDeleted, importsDeleted });
}
