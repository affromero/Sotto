import { NextRequest, NextResponse } from 'next/server';
import { prisma, prismaUnfiltered } from '@/lib/prisma';
import { authenticateRequest, type AuthenticatedRequest } from '@/lib/api-keys';
import { AccessError, isAccessError } from 'thesidedoor-core/access';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import {
  admitInitialStitch,
  prepareInitialStitchIdentities,
} from '@/lib/sidedoor/jobs/initial/initial-stitch-admission';
import { deliverSottoJob } from '@/lib/sidedoor/jobs/core/job-delivery';
import { isUserAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import {
  contentExtractionQueue,
  deepResearchQueue,
  creativePlanningQueue,
  scriptWritingQueue,
  compileScriptQueue,
  audioStitchingQueue,
  admitDurableJob,
  JobType,
} from '@/lib/queue';
import { determineResumePoint, type ResumePoint } from '@/lib/pipeline-resume';
import { MAX_LESSON_DURATION_MINUTES } from '@/lib/generation-limits';
import type { ExtractContentPayload } from '@/lib/queue';
import { randomUUID } from 'crypto';
import { restartExistingSegmentAudio } from '@/lib/segment-creator';
import type { Queue } from 'bullmq';
import type { Prisma } from '@/generated/prisma/client';

type RouteParams = { params: Promise<{ episodeId: string }> };

async function admitPipelineStage<T>(options: {
  queue: Queue;
  type: JobType;
  payload: T;
  jobId: string;
  status: 'EXTRACTING' | 'RESEARCHING' | 'PLANNING' | 'SCRIPTING' | 'COMPILING';
  expected: readonly ('PENDING' | 'DISCOVERING' | 'FAILED')[];
  episodeId: string;
  ownerId: string;
  request: Request;
  identity: AuthenticatedRequest;
  mutate?: (database: Prisma.TransactionClient) => Promise<void>;
}) {
  return admitDurableJob(options.queue, options.type, options.payload, {
    jobId: options.jobId,
    authorize: async (database) => {
      await requireOriginalSottoAdmission(database, options.request, options.identity);
      if (options.identity.userId !== options.ownerId && !options.identity.isOwner)
        throw new AccessError('forbidden');
      const episode = await database.episode.findUnique({
        where: { id: options.episodeId },
        select: { userId: true },
      });
      if (!episode || episode.userId !== options.ownerId) throw new AccessError('conflict');
      return { userId: options.ownerId };
    },
    mutate: async (database, operationId) => {
      const claimed = await database.episode.updateMany({
        where: { id: options.episodeId, status: { in: [...options.expected] } },
        data: {
          status: options.status,
          pipelineGeneration: operationId,
          failedAtStatus: null,
          failureReason: null,
        },
      });
      if (claimed.count !== 1)
        throw new AccessError('conflict', 'Episode is no longer in the expected pipeline state');
      await options.mutate?.(database);
    },
  });
}

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
  const isAdmin = await isUserAdmin(authResult);

  // Admin-only flag: use platform API keys.
  const allowSharedCredential =
    isAdmin && request.nextUrl.searchParams.get('allowSharedCredential') === 'true';

  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: {
      id: true,
      userId: true,
      status: true,
      failedAtStatus: true,
      audioGenerationKey: true,
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
      const payload: ExtractContentPayload = {
        episodeId,
        userId: episode.userId,
        sourceUrl: episode.discovery?.sourceUrl ?? undefined,
        sourceText: episode.discovery?.sourceContent ?? undefined,
        allowSharedCredential: allowSharedCredential || undefined,
      };
      await admitPipelineStage({
        queue: contentExtractionQueue,
        type: JobType.EXTRACT_CONTENT,
        payload,
        jobId: `extract-${episodeId}-${randomUUID()}`,
        status: 'EXTRACTING',
        expected: ['FAILED'],
        episodeId,
        ownerId: episode.userId,
        request,
        identity: authResult,
        mutate: async (database) => {
          await database.episodeVersionSegment.deleteMany({ where: { version: { episodeId } } });
          await database.episodeVersion.deleteMany({ where: { episodeId } });
          await database.segment.deleteMany({ where: { episodeId } });
          await database.reference.deleteMany({ where: { episodeId } });
          await database.script.deleteMany({ where: { episodeId } });
        },
      });
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
        episode.userId,
        episode,
        resumePoint,
        allowSharedCredential,
        {
          request,
          identity: authResult,
          ownerId: episode.userId,
          generationKey: episode.audioGenerationKey,
        },
        bodyProvider ? { provider: bodyProvider, model: bodyModel } : undefined
      );
    }
  }

  // Standard generation pipeline: start from scratch (CAS prevents concurrent starts)
  const payload: ExtractContentPayload = {
    episodeId,
    userId: episode.userId,
    sourceUrl: episode.discovery?.sourceUrl ?? undefined,
    sourceText: episode.discovery?.sourceContent ?? undefined,
    allowSharedCredential: allowSharedCredential || undefined,
  };

  await admitPipelineStage({
    queue: contentExtractionQueue,
    type: JobType.EXTRACT_CONTENT,
    payload,
    jobId: `extract-${episodeId}-${randomUUID()}`,
    status: 'EXTRACTING',
    expected: ['PENDING', 'DISCOVERING'],
    episodeId,
    ownerId: episode.userId,
    request,
    identity: authResult,
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
  allowSharedCredential: boolean,
  admission: {
    request: Request;
    identity: AuthenticatedRequest;
    ownerId: string;
    generationKey: string | null;
  },
  ttsOverride?: { provider: string; model?: string }
): Promise<NextResponse> {
  switch (resumePoint.step) {
    case 'EXTRACT_CONTENT': {
      const payload: ExtractContentPayload = {
        episodeId,
        userId,
        sourceUrl: episode.discovery?.sourceUrl ?? undefined,
        sourceText: episode.discovery?.sourceContent ?? undefined,
        allowSharedCredential: allowSharedCredential || undefined,
      };

      await admitPipelineStage({
        queue: contentExtractionQueue,
        type: JobType.EXTRACT_CONTENT,
        payload,
        jobId: `extract-${episodeId}-${randomUUID()}`,
        status: 'EXTRACTING',
        expected: ['FAILED'],
        episodeId,
        ownerId: admission.ownerId,
        request: admission.request,
        identity: admission.identity,
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

      const payload = {
        episodeId,
        userId,
        discoveryId: discovery.id,
        allowSharedCredential: allowSharedCredential || undefined,
      };
      await admitPipelineStage({
        queue: deepResearchQueue,
        type: JobType.DEEP_RESEARCH,
        payload,
        jobId: `research-${episodeId}-${randomUUID()}`,
        status: 'RESEARCHING',
        expected: ['FAILED'],
        episodeId,
        ownerId: admission.ownerId,
        request: admission.request,
        identity: admission.identity,
      });
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

      const payload = {
        episodeId,
        userId,
        discoveryId: discovery.id,
        dossierId: dossier.id,
        allowSharedCredential: allowSharedCredential || undefined,
      };
      await admitPipelineStage({
        queue: creativePlanningQueue,
        type: JobType.CREATIVE_PLANNING,
        payload,
        jobId: `plan-${episodeId}-${randomUUID()}`,
        status: 'PLANNING',
        expected: ['FAILED'],
        episodeId,
        ownerId: admission.ownerId,
        request: admission.request,
        identity: admission.identity,
      });
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

      const payload = {
        episodeId,
        userId,
        discoveryId: discovery.id,
        dossierId: dossier.id,
        outlineId: outline.id,
        allowSharedCredential: allowSharedCredential || undefined,
      };
      await admitPipelineStage({
        queue: scriptWritingQueue,
        type: JobType.WRITE_SCRIPT,
        payload,
        jobId: `write-${episodeId}-${randomUUID()}`,
        status: 'SCRIPTING',
        expected: ['FAILED'],
        episodeId,
        ownerId: admission.ownerId,
        request: admission.request,
        identity: admission.identity,
        mutate: async (database) => {
          await database.reference.deleteMany({ where: { episodeId } });
          await database.script.deleteMany({ where: { episodeId } });
        },
      });
      return NextResponse.json({
        success: true,
        message: 'Generation resumed from script writing',
        resumedAt: 'WRITE_SCRIPT',
      });
    }

    case 'COMPILE_SCRIPT': {
      const payload = {
        episodeId,
        userId,
        allowSharedCredential: allowSharedCredential || undefined,
      };
      await admitPipelineStage({
        queue: compileScriptQueue,
        type: JobType.COMPILE_SCRIPT,
        payload,
        jobId: `compile-${episodeId}-${randomUUID()}`,
        status: 'COMPILING',
        expected: ['FAILED'],
        episodeId,
        ownerId: admission.ownerId,
        request: admission.request,
        identity: admission.identity,
      });
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
        segmentCount = await restartExistingSegmentAudio(episodeId, audioGenerationKey, {
          authorize: async (database) => {
            await requireOriginalSottoAdmission(database, admission.request, admission.identity);
            const current = await database.episode.findUnique({
              where: { id: episodeId },
              select: { userId: true },
            });
            if (!current || current.userId !== admission.ownerId) throw new AccessError('conflict');
            return { userId: admission.ownerId };
          },
        });
      });

      return NextResponse.json({
        success: true,
        message: `Audio generation restarted (${segmentCount} segments)`,
        resumedAt: 'GENERATE_AUDIO',
        segments: segmentCount,
      });
    }

    case 'STITCH_AUDIO': {
      try {
        if (!admission.generationKey)
          return errorResponse('The audio generation identity is missing', 409);
        const generationKey = admission.generationKey;
        const identities = prepareInitialStitchIdentities();
        const result = await sottoTransaction(
          prismaUnfiltered,
          (tx) =>
            admitInitialStitch(tx, {
              episodeId,
              generationKey,
              soundPolicy: 'elevenlabs',
              identities,
              fromPhase: 'FAILED',
              signal: admission.request.signal,
              authorize: async (database) => {
                await requireOriginalSottoAdmission(
                  database,
                  admission.request,
                  admission.identity
                );
                if (
                  admission.ownerId !== admission.identity.userId &&
                  !isUserAdmin(admission.identity)
                )
                  throw new AccessError('forbidden');
                return { userId: admission.ownerId };
              },
            }),
          { signal: admission.request.signal }
        );
        if (result.kind === 'waiting')
          return errorResponse('Some segments still require audio generation', 409);
        await deliverSottoJob({
          database: prismaUnfiltered,
          queue: audioStitchingQueue,
          operationId: result.record.job.id,
          fingerprint: result.record.fingerprint,
          version: 2,
        });
        return NextResponse.json({
          success: true,
          message: 'Generation resumed from audio stitching',
          resumedAt: 'STITCH_AUDIO',
        });
      } catch (error) {
        if (!isAccessError(error)) throw error;
        return errorResponse(
          error.message,
          error.code === 'unauthorized' ? 401 : error.code === 'forbidden' ? 403 : 409
        );
      }
    }
  }
}
