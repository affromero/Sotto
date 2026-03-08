import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { resolveReportSchema } from '@/lib/validations';
import { deleteFile } from '@/lib/r2';
import { addJob, visualGenerationQueue, JobType } from '@/lib/queue';
import { createNotification } from '@/lib/notifications';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';

type RouteParams = { params: Promise<{ reportId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { reportId } = await params;
  const session = await auth();

  if (!session?.user?.id || session.user.role !== 'ADMIN') {
    return errorResponse('Forbidden', 403);
  }

  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: {
      reporter: { select: { id: true, name: true, email: true, handle: true } },
      segmentVisual: { select: { id: true, assetUrl: true, visualType: true, status: true } },
    },
  });

  if (!report) {
    return errorResponse('Report not found', 404);
  }

  return NextResponse.json(report);
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { reportId } = await params;
  const session = await auth();

  if (!session?.user?.id || session.user.role !== 'ADMIN') {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json();
  const parsed = resolveReportSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      status: true,
      reason: true,
      targetType: true,
      targetId: true,
      segmentVisualId: true,
    },
  });

  if (!report) {
    return errorResponse('Report not found', 404);
  }

  const terminalStatuses = ['RESOLVED_ACTIONED', 'RESOLVED_DISMISSED', 'ASSET_REPLACED', 'DELISTED'];
  if (terminalStatuses.includes(report.status)) {
    return errorResponse('Report already resolved', 409);
  }

  const updated = await prisma.report.update({
    where: { id: reportId },
    data: {
      status: parsed.data.status,
      resolution: parsed.data.resolution ?? null,
      resolvedBy: session.user.id,
      resolvedAt: new Date(),
    },
  });

  // Copyright-specific resolution actions
  if (report.reason === 'COPYRIGHT') {
    const podcastId = report.targetType === 'podcast' ? report.targetId : null;

    if (parsed.data.status === 'ASSET_REPLACED' && report.segmentVisualId) {
      await handleAssetReplacement(report.segmentVisualId, podcastId);
    } else if (parsed.data.status === 'DELISTED' && podcastId) {
      await prisma.podcast.update({
        where: { id: podcastId },
        data: { isDelisted: true },
      });
    }

    // Notify the podcast creator
    if (podcastId) {
      const podcast = await prisma.podcast.findUnique({
        where: { id: podcastId },
        select: { userId: true, title: true },
      });
      if (podcast) {
        const actionLabel = parsed.data.status === 'ASSET_REPLACED'
          ? 'A visual asset was replaced'
          : parsed.data.status === 'DELISTED'
            ? 'Your podcast was delisted'
            : 'A copyright report was resolved';

        await createNotification(
          podcast.userId,
          'CONTENT_REMOVED',
          'Copyright claim resolved',
          `${actionLabel} on "${podcast.title}" due to a copyright claim.`,
          { podcastId, reportId },
        );
      }
    }
  }

  return NextResponse.json(updated);
}

async function handleAssetReplacement(segmentVisualId: string, podcastId: string | null): Promise<void> {
  const visual = await prisma.segmentVisual.findUnique({
    where: { id: segmentVisualId },
    select: { id: true, assetUrl: true, videoGenerationId: true },
  });

  if (!visual) return;

  // Delete the R2 asset
  if (visual.assetUrl) {
    try {
      await deleteFile(visual.assetUrl);
    } catch (err) {
      logger.warn('Failed to delete R2 asset during copyright resolution', {
        segmentVisualId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Reset the visual to pending AI illustration
  await prisma.segmentVisual.update({
    where: { id: segmentVisualId },
    data: {
      visualType: 'AI_ILLUSTRATION',
      assetUrl: null,
      assetType: null,
      status: 'pending',
      metadata: {},
    },
  });

  // Queue re-generation
  if (podcastId) {
    const updatedVisual = await prisma.segmentVisual.findUnique({
      where: { id: segmentVisualId },
      select: { prompt: true },
    });

    await addJob(visualGenerationQueue, JobType.GENERATE_VISUAL, {
      podcastId,
      videoGenerationId: visual.videoGenerationId,
      segmentVisualId,
      visualType: 'AI_ILLUSTRATION',
      prompt: updatedVisual?.prompt ?? 'Abstract illustration',
    });
  }
}
