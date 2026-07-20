import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { isUserAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import {
  contentExtractionQueue,
  deepResearchQueue,
  creativePlanningQueue,
  scriptWritingQueue,
  compileScriptQueue,
  audioStitchingQueue,
  addJob,
  JobType,
} from '@/lib/queue';
import { determineResumePoint, type ResumePoint } from '@/lib/pipeline-resume';
import { MAX_LESSON_DURATION_MINUTES } from '@/lib/generation-limits';
import type { ExtractContentPayload, StitchAudioPayload } from '@/lib/queue';
import { randomUUID } from 'crypto';
import { createStitchJobId } from '@/lib/audio/stitch-identity';
import { restartExistingSegmentAudio } from '@/lib/segment-creator';

type RouteParams = { params: Promise<{ episodeId: string }> };

async function enqueueAfterClaim(
  episodeId: string,
  claimedStatus:
    | 'EXTRACTING'
    | 'RESEARCHING'
    | 'PLANNING'
    | 'SCRIPTING'
    | 'COMPILING'
    | 'GENERATING_AUDIO'
    | 'STITCHING',
  enqueue: () => Promise<unknown>
): Promise<void> {
  try {
    await enqueue();
  } catch (error) {
    await prisma.episode.updateMany({
      where: { id: episodeId, status: claimedStatus },
      data: {
        status: 'FAILED',
        failedAtStatus: claimedStatus,
        failureReason: 'The pipeline could not be queued. Retry generation.',
        technicalError: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { episodeId } = await params;
  const authResult = await authenticateRequest(request);

  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  // Admin bypass: skip ownership checks. Resolve the role for the authenticated
  // principal (Bearer key or session), not the ambient session.
  const isAdmin = await isUserAdmin(authResult.userId);

  // Admin-only flag: use platform API keys.
  const useAdminCredits = isAdmin && request.nextUrl.searchParams.get('useAdminCredits') === 'true';

  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: {
      id: true,
      userId: true,
      status: true,
      failedAtStatus: true,
      discovery: {
        select: { id: true, sourceUrl: true, sourceContent: true, durationTarget: true },
      },
    },
  });

  if (!episode) {
    return errorResponse('Episode not found', 404);
  }

  if (episode.userId !== authResult.userId && !isAdmin) {
    return errorResponse('Forbidden', 403);
  }

  if (
    episode.status !== 'PENDING' &&
    episode.status !== 'DISCOVERING' &&
    episode.status !== 'FAILED'
  ) {
    return errorResponse(
      'Episode must be in PENDING, DISCOVERING, or FAILED status to generate',
      400
    );
  }

  const durationTarget = episode.discovery?.durationTarget;
  if (durationTarget && durationTarget > MAX_LESSON_DURATION_MINUTES) {
    return errorResponse(
      `Requested duration of ${durationTarget} minutes exceeds the maximum of ${MAX_LESSON_DURATION_MINUTES} minutes.`,
      400
    );
  }

  // For FAILED episodes: smart resume or force restart
  if (episode.status === 'FAILED') {
    await prisma.job.updateMany({
      where: { episodeId, status: 'failed' },
      data: { status: 'superseded' },
    });

    const forceRestart = request.nextUrl.searchParams.get('forceRestart') === 'true';

    if (forceRestart) {
      const claimed = await prisma.$transaction(async (tx) => {
        const cas = await tx.episode.updateMany({
          where: { id: episodeId, status: 'FAILED' },
          data: { status: 'EXTRACTING', failedAtStatus: null, failureReason: null },
        });
        if (cas.count === 0) return false;
        await tx.episodeVersionSegment.deleteMany({ where: { version: { episodeId } } });
        await tx.episodeVersion.deleteMany({ where: { episodeId } });
        await tx.segment.deleteMany({ where: { episodeId } });
        await tx.reference.deleteMany({ where: { episodeId } });
        await tx.script.deleteMany({ where: { episodeId } });
        return true;
      });
      if (!claimed) return errorResponse('Episode is no longer in a restartable state', 409);

      const payload: ExtractContentPayload = {
        episodeId,
        userId: authResult.userId,
        sourceUrl: episode.discovery?.sourceUrl ?? undefined,
        sourceText: episode.discovery?.sourceContent ?? undefined,
        useAdminCredits: useAdminCredits || undefined,
      };
      await enqueueAfterClaim(episodeId, 'EXTRACTING', () =>
        addJob(contentExtractionQueue, JobType.EXTRACT_CONTENT, payload, {
          jobId: `extract-${episodeId}-${Date.now()}`,
        })
      );
      return NextResponse.json({ success: true, message: 'Generation started' });
    } else {
      // Smart resume: inspect existing data and pick up where we left off
      const resumePoint = await determineResumePoint(episodeId);

      // Parse optional provider override from JSON body (audio failure retry)
      let bodyProvider: string | undefined;
      let bodyModel: string | undefined;
      try {
        const body = await request.json();
        bodyProvider = body?.ttsProvider;
        bodyModel = body?.ttsModel;
      } catch {
        // No JSON body — bare retry
      }

      return await routeResume(
        episodeId,
        authResult.userId,
        episode,
        resumePoint,
        useAdminCredits,
        bodyProvider ? { provider: bodyProvider, model: bodyModel } : undefined
      );
    }
  }

  // Standard generation pipeline: start from scratch (CAS prevents concurrent starts)
  const cas = await prisma.episode.updateMany({
    where: { id: episodeId, status: { in: ['PENDING', 'DISCOVERING'] } },
    data: { status: 'EXTRACTING', failedAtStatus: null, failureReason: null },
  });
  if (cas.count === 0) {
    return errorResponse('Episode is no longer in a startable state', 409);
  }

  const payload: ExtractContentPayload = {
    episodeId,
    userId: authResult.userId,
    sourceUrl: episode.discovery?.sourceUrl ?? undefined,
    sourceText: episode.discovery?.sourceContent ?? undefined,
    useAdminCredits: useAdminCredits || undefined,
  };

  await enqueueAfterClaim(episodeId, 'EXTRACTING', () =>
    addJob(contentExtractionQueue, JobType.EXTRACT_CONTENT, payload, {
      jobId: `extract-${episodeId}`,
    })
  );

  return NextResponse.json({ success: true, message: 'Generation started' });
}

/**
 * Route to the correct pipeline step based on the resume point.
 */
async function routeResume(
  episodeId: string,
  userId: string,
  episode: {
    discovery: { id: string; sourceUrl: string | null; sourceContent: string | null } | null;
  },
  resumePoint: ResumePoint,
  useAdminCredits: boolean,
  ttsOverride?: { provider: string; model?: string }
): Promise<NextResponse> {
  switch (resumePoint.step) {
    case 'EXTRACT_CONTENT': {
      const casExtract = await prisma.episode.updateMany({
        where: { id: episodeId, status: 'FAILED' },
        data: { status: 'EXTRACTING', failedAtStatus: null, failureReason: null },
      });
      if (casExtract.count === 0) {
        return errorResponse('Episode is no longer in a resumable state', 409);
      }

      const payload: ExtractContentPayload = {
        episodeId,
        userId,
        sourceUrl: episode.discovery?.sourceUrl ?? undefined,
        sourceText: episode.discovery?.sourceContent ?? undefined,
        useAdminCredits: useAdminCredits || undefined,
      };

      await enqueueAfterClaim(episodeId, 'EXTRACTING', () =>
        addJob(contentExtractionQueue, JobType.EXTRACT_CONTENT, payload, {
          jobId: `extract-${episodeId}-${Date.now()}`,
        })
      );
      return NextResponse.json({
        success: true,
        message: 'Generation resumed from content extraction',
        resumedAt: 'EXTRACT_CONTENT',
      });
    }

    case 'DEEP_RESEARCH': {
      const discovery = await prisma.discovery.findUniqueOrThrow({
        where: { episodeId },
      });

      const casResearch = await prisma.episode.updateMany({
        where: { id: episodeId, status: 'FAILED' },
        data: { status: 'RESEARCHING', failedAtStatus: null, failureReason: null },
      });
      if (casResearch.count === 0) {
        return errorResponse('Episode is no longer in a resumable state', 409);
      }

      await enqueueAfterClaim(episodeId, 'RESEARCHING', () =>
        addJob(
          deepResearchQueue,
          JobType.DEEP_RESEARCH,
          {
            episodeId,
            userId,
            discoveryId: discovery.id,
            useAdminCredits: useAdminCredits || undefined,
          },
          { jobId: `research-${episodeId}-${Date.now()}` }
        )
      );
      return NextResponse.json({
        success: true,
        message: 'Generation resumed from deep research',
        resumedAt: 'DEEP_RESEARCH',
      });
    }

    case 'CREATIVE_PLANNING': {
      const [discovery, dossier] = await Promise.all([
        prisma.discovery.findUniqueOrThrow({ where: { episodeId } }),
        prisma.researchDossier.findUniqueOrThrow({ where: { episodeId } }),
      ]);

      const casPlanning = await prisma.episode.updateMany({
        where: { id: episodeId, status: 'FAILED' },
        data: { status: 'PLANNING', failedAtStatus: null, failureReason: null },
      });
      if (casPlanning.count === 0) {
        return errorResponse('Episode is no longer in a resumable state', 409);
      }

      await enqueueAfterClaim(episodeId, 'PLANNING', () =>
        addJob(
          creativePlanningQueue,
          JobType.CREATIVE_PLANNING,
          {
            episodeId,
            userId,
            discoveryId: discovery.id,
            dossierId: dossier.id,
            useAdminCredits: useAdminCredits || undefined,
          },
          { jobId: `plan-${episodeId}-${Date.now()}` }
        )
      );
      return NextResponse.json({
        success: true,
        message: 'Generation resumed from creative planning',
        resumedAt: 'CREATIVE_PLANNING',
      });
    }

    case 'WRITE_SCRIPT': {
      const [discovery, dossier, outline] = await Promise.all([
        prisma.discovery.findUniqueOrThrow({ where: { episodeId } }),
        prisma.researchDossier.findUniqueOrThrow({ where: { episodeId } }),
        prisma.creativeOutline.findUniqueOrThrow({ where: { episodeId } }),
      ]);

      const casWrite = await prisma.episode.updateMany({
        where: { id: episodeId, status: 'FAILED' },
        data: { status: 'SCRIPTING', failedAtStatus: null, failureReason: null },
      });
      if (casWrite.count === 0) {
        return errorResponse('Episode is no longer in a resumable state', 409);
      }
      await prisma.$transaction([
        prisma.reference.deleteMany({ where: { episodeId } }),
        prisma.script.deleteMany({ where: { episodeId } }),
      ]);

      await enqueueAfterClaim(episodeId, 'SCRIPTING', () =>
        addJob(
          scriptWritingQueue,
          JobType.WRITE_SCRIPT,
          {
            episodeId,
            userId,
            discoveryId: discovery.id,
            dossierId: dossier.id,
            outlineId: outline.id,
            useAdminCredits: useAdminCredits || undefined,
          },
          { jobId: `write-${episodeId}-${Date.now()}` }
        )
      );
      return NextResponse.json({
        success: true,
        message: 'Generation resumed from script writing',
        resumedAt: 'WRITE_SCRIPT',
      });
    }

    case 'COMPILE_SCRIPT': {
      const casCompile = await prisma.episode.updateMany({
        where: { id: episodeId, status: 'FAILED' },
        data: { status: 'COMPILING', failedAtStatus: null, failureReason: null },
      });
      if (casCompile.count === 0) {
        return errorResponse('Episode is no longer in a resumable state', 409);
      }

      await enqueueAfterClaim(episodeId, 'COMPILING', () =>
        addJob(
          compileScriptQueue,
          JobType.COMPILE_SCRIPT,
          {
            episodeId,
            userId,
            useAdminCredits: useAdminCredits || undefined,
          },
          { jobId: `compile-${episodeId}-${Date.now()}` }
        )
      );
      return NextResponse.json({
        success: true,
        message: 'Generation resumed from script compilation',
        resumedAt: 'COMPILE_SCRIPT',
      });
    }

    case 'SCRIPT_READY': {
      // Clear TTS provider so user re-enters audio config UI (CAS on FAILED)
      const casReady = await prisma.episode.updateMany({
        where: { id: episodeId, status: 'FAILED' },
        data: {
          status: 'SCRIPT_READY',
          failedAtStatus: null,
          failureReason: null,
          ttsProvider: null,
          ttsModel: null,
        },
      });
      if (casReady.count === 0) {
        return errorResponse('Episode is no longer in a resumable state', 409);
      }
      await prisma.$transaction([
        prisma.episodeVersionSegment.deleteMany({ where: { version: { episodeId } } }),
        prisma.episodeVersion.deleteMany({ where: { episodeId } }),
        prisma.segment.deleteMany({ where: { episodeId } }),
        prisma.episodeVoice.deleteMany({ where: { episodeId } }),
      ]);

      return NextResponse.json({
        success: true,
        message: 'Script is ready for review — approve to continue',
        resumedAt: 'SCRIPT_READY',
      });
    }

    case 'GENERATE_AUDIO': {
      const audioGenerationKey = randomUUID();
      const casAudio = await prisma.episode.updateMany({
        where: { id: episodeId, status: 'FAILED' },
        data: {
          status: 'GENERATING_AUDIO',
          failedAtStatus: null,
          failureReason: null,
          audioGenerationKey,
        },
      });
      if (casAudio.count === 0) {
        return errorResponse('Episode is no longer in a resumable state', 409);
      }
      if (ttsOverride) {
        await prisma.$transaction([
          prisma.episode.update({
            where: { id: episodeId },
            data: { ttsProvider: ttsOverride.provider, ttsModel: ttsOverride.model ?? null },
          }),
          prisma.episodeVoice.deleteMany({ where: { episodeId } }),
        ]);
      }

      let segmentCount = 0;
      await enqueueAfterClaim(episodeId, 'GENERATING_AUDIO', async () => {
        segmentCount = await restartExistingSegmentAudio(episodeId, audioGenerationKey);
      });

      return NextResponse.json({
        success: true,
        message: `Audio generation restarted (${segmentCount} segments)`,
        resumedAt: 'GENERATE_AUDIO',
        segments: segmentCount,
      });
    }

    case 'STITCH_AUDIO': {
      const casStitch = await prisma.episode.updateMany({
        where: { id: episodeId, status: 'FAILED' },
        data: {
          status: 'STITCHING',
          failedAtStatus: null,
          failureReason: null,
          activeStitchKey: null,
          activeStitchOwner: null,
        },
      });
      if (casStitch.count === 0) {
        return errorResponse('Episode is no longer in a resumable state', 409);
      }

      const stitchSegments = await prisma.segment.findMany({
        where: { id: { in: resumePoint.segmentIds }, episodeId },
        orderBy: { order: 'asc' },
        select: { id: true, version: true, audioUrl: true },
      });
      const payload: StitchAudioPayload = {
        episodeId,
        segmentIds: stitchSegments.map((segment) => segment.id),
        segmentVersions: stitchSegments.map((segment) => segment.version),
        segmentAudioUrls: stitchSegments.map((segment) => segment.audioUrl!),
      };

      await enqueueAfterClaim(episodeId, 'STITCHING', () =>
        addJob(audioStitchingQueue, JobType.STITCH_AUDIO, payload, {
          jobId: createStitchJobId(episodeId, stitchSegments),
        })
      );
      return NextResponse.json({
        success: true,
        message: 'Generation resumed from audio stitching',
        resumedAt: 'STITCH_AUDIO',
      });
    }
  }
}
