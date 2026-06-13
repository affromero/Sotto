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
  audioGenerationQueue,
  audioStitchingQueue,
  addJob,
  JobType,
} from '@/lib/queue';
import { determineResumePoint, type ResumePoint } from '@/lib/pipeline-resume';
import { MAX_LESSON_DURATION_MINUTES } from '@/lib/generation-limits';
import type {
  ExtractContentPayload,
  GenerateAudioPayload,
  StitchAudioPayload,
} from '@/lib/queue';

type RouteParams = { params: Promise<{ episodeId: string }> };

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
      400,
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
      // Escape hatch: nuke everything, start from scratch
      await prisma.episodeVersionSegment.deleteMany({
        where: { version: { episodeId } },
      });
      await prisma.episodeVersion.deleteMany({ where: { episodeId } });
      await prisma.segment.deleteMany({ where: { episodeId } });
      await prisma.reference.deleteMany({ where: { episodeId } });
      await prisma.script.deleteMany({ where: { episodeId } });
      await prisma.episode.update({
        where: { id: episodeId },
        data: { failedAtStatus: null, failureReason: null },
      });
      // Fall through to normal routing below
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

      if (bodyProvider) {
        // User picked a different provider — override the dead one
        await prisma.episode.update({
          where: { id: episodeId },
          data: { ttsProvider: bodyProvider, ttsModel: bodyModel ?? null },
        });
        // Old voice IDs are provider-specific — clear them
        await prisma.episodeVoice.deleteMany({ where: { episodeId } });
      }
      // Bare retry: keep ttsProvider so the same voices are used on retry.
      // The queue failure handler (queue.ts) already clears ttsProvider for
      // key invalidation errors. For transient failures, preserving the
      // provider ensures voice consistency.

      return await routeResume(
        episodeId,
        authResult.userId,
        episode,
        resumePoint,
        useAdminCredits
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

  await addJob(contentExtractionQueue, JobType.EXTRACT_CONTENT, payload, {
    jobId: `extract-${episodeId}`,
  });

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
  useAdminCredits: boolean
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

      await addJob(contentExtractionQueue, JobType.EXTRACT_CONTENT, payload, {
        jobId: `extract-${episodeId}-${Date.now()}`,
      });
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

      await addJob(
        deepResearchQueue,
        JobType.DEEP_RESEARCH,
        {
          episodeId,
          userId,
          discoveryId: discovery.id,
          useAdminCredits: useAdminCredits || undefined,
        },
        { jobId: `research-${episodeId}-${Date.now()}` }
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

      await addJob(
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
      );
      return NextResponse.json({
        success: true,
        message: 'Generation resumed from creative planning',
        resumedAt: 'CREATIVE_PLANNING',
      });
    }

    case 'WRITE_SCRIPT': {
      // Delete stale script and refs before rewriting
      await prisma.reference.deleteMany({ where: { episodeId } });
      await prisma.script.deleteMany({ where: { episodeId } });

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

      await addJob(
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

      await addJob(
        compileScriptQueue,
        JobType.COMPILE_SCRIPT,
        {
          episodeId,
          userId,
        },
        { jobId: `compile-${episodeId}-${Date.now()}` }
      );
      return NextResponse.json({
        success: true,
        message: 'Generation resumed from script compilation',
        resumedAt: 'COMPILE_SCRIPT',
      });
    }

    case 'SCRIPT_READY': {
      // Delete stale segments and versions
      await prisma.episodeVersionSegment.deleteMany({
        where: { version: { episodeId } },
      });
      await prisma.episodeVersion.deleteMany({ where: { episodeId } });
      await prisma.segment.deleteMany({ where: { episodeId } });
      // Clear stale voice assignments — re-approval will assign fresh voices
      // for whatever provider the user picks
      await prisma.episodeVoice.deleteMany({ where: { episodeId } });

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

      return NextResponse.json({
        success: true,
        message: 'Script is ready for review — approve to continue',
        resumedAt: 'SCRIPT_READY',
      });
    }

    case 'GENERATE_AUDIO': {
      const casAudio = await prisma.episode.updateMany({
        where: { id: episodeId, status: 'FAILED' },
        data: { status: 'GENERATING_AUDIO', failedAtStatus: null, failureReason: null },
      });
      if (casAudio.count === 0) {
        return errorResponse('Episode is no longer in a resumable state', 409);
      }

      // Queue audio generation only for pending segments
      const pendingSegments = await prisma.segment.findMany({
        where: { id: { in: resumePoint.pendingSegmentIds } },
        select: { id: true, speaker: true, text: true },
      });

      for (const seg of pendingSegments) {
        const payload: GenerateAudioPayload = {
          episodeId,
          segmentId: seg.id,
          speaker: seg.speaker,
          text: seg.text,
        };
        await addJob(audioGenerationQueue, JobType.GENERATE_AUDIO, payload, {
          jobId: `audio-${episodeId}-${seg.id}-${Date.now()}`,
        });
      }

      return NextResponse.json({
        success: true,
        message: `Generation resumed from audio generation (${pendingSegments.length} segments remaining)`,
        resumedAt: 'GENERATE_AUDIO',
        pendingSegments: pendingSegments.length,
      });
    }

    case 'STITCH_AUDIO': {
      // Delete stale episode versions
      await prisma.episodeVersionSegment.deleteMany({
        where: { version: { episodeId } },
      });
      await prisma.episodeVersion.deleteMany({ where: { episodeId } });

      const casStitch = await prisma.episode.updateMany({
        where: { id: episodeId, status: 'FAILED' },
        data: { status: 'STITCHING', failedAtStatus: null, failureReason: null },
      });
      if (casStitch.count === 0) {
        return errorResponse('Episode is no longer in a resumable state', 409);
      }

      const payload: StitchAudioPayload = {
        episodeId,
        segmentIds: resumePoint.segmentIds,
      };

      await addJob(audioStitchingQueue, JobType.STITCH_AUDIO, payload, {
        jobId: `stitch-${episodeId}-${Date.now()}`,
      });
      return NextResponse.json({
        success: true,
        message: 'Generation resumed from audio stitching',
        resumedAt: 'STITCH_AUDIO',
      });
    }
  }
}
