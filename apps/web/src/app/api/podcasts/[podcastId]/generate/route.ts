import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import {
  contentExtractionQueue,
  deepResearchQueue,
  creativePlanningQueue,
  scriptWritingQueue,
  compileScriptQueue,
  audioGenerationQueue,
  audioStitchingQueue,
  audioImportQueue,
  addJob,
  JobType,
} from '@/lib/queue';
import { checkGenerationGate } from '@/lib/generation-gate';
import { getTierFeatures } from '@/lib/tier-features';
import { selectFreeTierProviders } from '@/lib/free-tier-provider-selector';
import { checkRateLimit } from '@/lib/redis';
import { determineResumePoint, type ResumePoint } from '@/lib/pipeline-resume';
import { resolveSttProvider } from '@/lib/providers/stt';
import type {
  ExtractContentPayload,
  ImportAudioPayload,
  GenerateAudioPayload,
  StitchAudioPayload,
} from '@/lib/queue';
import type { SttProviderId } from '@sotto/shared';

type RouteParams = { params: Promise<{ podcastId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(request);

  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  // Admin bypass: skip rate limit, generation gate, and ownership checks
  const adminId = await requireAdmin();
  const isAdmin = adminId !== null;

  // Admin-only flag: use platform API keys + skip free-tier counter
  const useAdminCredits = isAdmin && request.nextUrl.searchParams.get('useAdminCredits') === 'true';

  // Rate limit: 20/hour, 100/day (skip for admins)
  if (!isAdmin) {
    const hourly = await checkRateLimit(`generate:hour:${authResult.userId}`, 20, 3600);
    if (!hourly.allowed) {
      return errorResponse('Rate limit exceeded: max 20 generations per hour.', 429);
    }
    const daily = await checkRateLimit(`generate:day:${authResult.userId}`, 100, 86400);
    if (!daily.allowed) {
      return errorResponse('Rate limit exceeded: max 100 generations per day.', 429);
    }
  }

  // Generation gate: BYOK or free tier (skip for admins)
  const gate = isAdmin
    ? {
        allowed: true as const,
        reason: 'admin' as const,
        isByokUser: true,
        isProUser: true,
        dailyUsed: 0,
        dailyLimit: 0,
      }
    : await checkGenerationGate(authResult.userId);
  if (!gate.allowed) {
    const msg =
      gate.reason === 'generation_in_progress'
        ? 'A podcast is already generating. Wait for it to finish before starting another.'
        : gate.reason === 'budget_exceeded'
          ? 'Monthly spend budget exceeded. Contact your admin to increase your limit.'
          : 'No voice provider available. Add a TTS key in Settings for unlimited generation.';
    return errorResponse(msg, 403, { code: gate.reason });
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: {
      id: true,
      userId: true,
      status: true,
      failedAtStatus: true,
      source: true,
      importedAudioKey: true,
      sttProvider: true,
      sttModel: true,
      isHumanContent: true,
      title: true,
      discovery: {
        select: { id: true, sourceUrl: true, sourceContent: true, durationTarget: true },
      },
    },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }

  if (podcast.userId !== authResult.userId && !isAdmin) {
    return errorResponse('Forbidden', 403);
  }

  if (
    podcast.status !== 'PENDING' &&
    podcast.status !== 'DISCOVERING' &&
    podcast.status !== 'FAILED'
  ) {
    return errorResponse(
      'Podcast must be in PENDING, DISCOVERING, or FAILED status to generate',
      400
    );
  }

  const plan: 'FREE' | 'PRO' = gate.isProUser ? 'PRO' : 'FREE';

  // Duration validation — use tier features for duration cap
  const tierFeatures = getTierFeatures(plan, gate.isByokUser, isAdmin ? 'ADMIN' : undefined);
  const effectiveMaxDuration = isFinite(tierFeatures.maxDurationMinutes)
    ? tierFeatures.maxDurationMinutes
    : 9999;
  const durationTarget = podcast.discovery?.durationTarget;
  if (durationTarget && durationTarget > effectiveMaxDuration) {
    return NextResponse.json(
      {
        error: `Requested duration (${durationTarget} min) exceeds the maximum of ${effectiveMaxDuration} minutes.`,
      },
      { status: 400 }
    );
  }

  // For FAILED podcasts: smart resume or force restart
  if (podcast.status === 'FAILED') {
    await prisma.job.updateMany({
      where: { podcastId, status: 'failed' },
      data: { status: 'superseded' },
    });

    const forceRestart = request.nextUrl.searchParams.get('forceRestart') === 'true';

    if (forceRestart) {
      // Escape hatch: nuke everything, start from scratch
      await prisma.podcastVersionSegment.deleteMany({
        where: { version: { podcastId } },
      });
      await prisma.podcastVersion.deleteMany({ where: { podcastId } });
      await prisma.segment.deleteMany({ where: { podcastId } });
      await prisma.reference.deleteMany({ where: { podcastId } });
      await prisma.script.deleteMany({ where: { podcastId } });
      await prisma.podcast.update({
        where: { id: podcastId },
        data: { failedAtStatus: null, failureReason: null },
      });
      // Fall through to normal routing below
    } else {
      // Smart resume: inspect existing data and pick up where we left off
      const resumePoint = await determineResumePoint(podcastId);

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
        await prisma.podcast.update({
          where: { id: podcastId },
          data: { ttsProvider: bodyProvider, ttsModel: bodyModel ?? null },
        });
        // Old voice IDs are provider-specific — clear them
        await prisma.podcastVoice.deleteMany({ where: { podcastId } });
      }
      // Bare retry: keep ttsProvider so the same voices are used on retry.
      // The queue failure handler (queue.ts) already clears ttsProvider for
      // key invalidation errors. For transient failures, preserving the
      // provider ensures voice consistency.

      if (useAdminCredits) {
        const selected = await selectFreeTierProviders(podcast.userId);
        await prisma.podcast.update({
          where: { id: podcastId },
          data: { aiModel: selected.aiModel },
        });
      }

      return await routeResume(
        podcastId,
        authResult.userId,
        podcast,
        resumePoint,
        useAdminCredits,
        plan
      );
    }
  }

  // Imported podcasts re-queue the import pipeline
  if (podcast.source === 'IMPORT' && podcast.importedAudioKey) {
    return await startImport(podcastId, authResult.userId, podcast, plan);
  }

  // Standard generation pipeline: start from scratch (CAS prevents concurrent starts)
  const cas = await prisma.podcast.updateMany({
    where: { id: podcastId, status: { in: ['PENDING', 'DISCOVERING'] } },
    data: { status: 'EXTRACTING', failedAtStatus: null, failureReason: null },
  });
  if (cas.count === 0) {
    return errorResponse('Podcast is no longer in a startable state', 409);
  }

  if (useAdminCredits || !gate.isByokUser) {
    // Persist the concrete platform model before the extraction job can run.
    const selected = await selectFreeTierProviders(
      useAdminCredits ? podcast.userId : authResult.userId
    );
    await prisma.podcast.update({
      where: { id: podcastId },
      data: { aiModel: selected.aiModel },
    });
  }

  const payload: ExtractContentPayload = {
    podcastId,
    userId: authResult.userId,
    sourceUrl: podcast.discovery?.sourceUrl ?? undefined,
    sourceText: podcast.discovery?.sourceContent ?? undefined,
    useAdminCredits: useAdminCredits || undefined,
  };

  await addJob(contentExtractionQueue, JobType.EXTRACT_CONTENT, payload, {
    jobId: `extract-${podcastId}`,
  });

  return NextResponse.json({ success: true, message: 'Generation started' });
}

/**
 * Route to the correct pipeline step based on the resume point.
 */
async function routeResume(
  podcastId: string,
  userId: string,
  podcast: {
    source: string;
    importedAudioKey: string | null;
    sttProvider: string | null;
    sttModel: string | null;
    isHumanContent: boolean;
    title: string;
    discovery: { id: string; sourceUrl: string | null; sourceContent: string | null } | null;
  },
  resumePoint: ResumePoint,
  useAdminCredits: boolean,
  plan: 'FREE' | 'PRO'
): Promise<NextResponse> {
  switch (resumePoint.step) {
    case 'IMPORT_AUDIO': {
      return await startImport(podcastId, userId, podcast, plan);
    }

    case 'EXTRACT_CONTENT': {
      const casExtract = await prisma.podcast.updateMany({
        where: { id: podcastId, status: 'FAILED' },
        data: { status: 'EXTRACTING', failedAtStatus: null, failureReason: null },
      });
      if (casExtract.count === 0) {
        return errorResponse('Podcast is no longer in a resumable state', 409);
      }

      const payload: ExtractContentPayload = {
        podcastId,
        userId,
        sourceUrl: podcast.discovery?.sourceUrl ?? undefined,
        sourceText: podcast.discovery?.sourceContent ?? undefined,
        useAdminCredits: useAdminCredits || undefined,
      };

      await addJob(contentExtractionQueue, JobType.EXTRACT_CONTENT, payload, {
        jobId: `extract-${podcastId}-${Date.now()}`,
      });
      return NextResponse.json({
        success: true,
        message: 'Generation resumed from content extraction',
        resumedAt: 'EXTRACT_CONTENT',
      });
    }

    case 'DEEP_RESEARCH': {
      const discovery = await prisma.discovery.findUniqueOrThrow({
        where: { podcastId },
      });

      const casResearch = await prisma.podcast.updateMany({
        where: { id: podcastId, status: 'FAILED' },
        data: { status: 'RESEARCHING', failedAtStatus: null, failureReason: null },
      });
      if (casResearch.count === 0) {
        return errorResponse('Podcast is no longer in a resumable state', 409);
      }

      await addJob(
        deepResearchQueue,
        JobType.DEEP_RESEARCH,
        {
          podcastId,
          userId,
          discoveryId: discovery.id,
          useAdminCredits: useAdminCredits || undefined,
        },
        { jobId: `research-${podcastId}-${Date.now()}` }
      );
      return NextResponse.json({
        success: true,
        message: 'Generation resumed from deep research',
        resumedAt: 'DEEP_RESEARCH',
      });
    }

    case 'CREATIVE_PLANNING': {
      const [discovery, dossier] = await Promise.all([
        prisma.discovery.findUniqueOrThrow({ where: { podcastId } }),
        prisma.researchDossier.findUniqueOrThrow({ where: { podcastId } }),
      ]);

      const casPlanning = await prisma.podcast.updateMany({
        where: { id: podcastId, status: 'FAILED' },
        data: { status: 'PLANNING', failedAtStatus: null, failureReason: null },
      });
      if (casPlanning.count === 0) {
        return errorResponse('Podcast is no longer in a resumable state', 409);
      }

      await addJob(
        creativePlanningQueue,
        JobType.CREATIVE_PLANNING,
        {
          podcastId,
          userId,
          discoveryId: discovery.id,
          dossierId: dossier.id,
          useAdminCredits: useAdminCredits || undefined,
        },
        { jobId: `plan-${podcastId}-${Date.now()}` }
      );
      return NextResponse.json({
        success: true,
        message: 'Generation resumed from creative planning',
        resumedAt: 'CREATIVE_PLANNING',
      });
    }

    case 'WRITE_SCRIPT': {
      // Delete stale script and refs before rewriting
      await prisma.reference.deleteMany({ where: { podcastId } });
      await prisma.script.deleteMany({ where: { podcastId } });

      const [discovery, dossier, outline] = await Promise.all([
        prisma.discovery.findUniqueOrThrow({ where: { podcastId } }),
        prisma.researchDossier.findUniqueOrThrow({ where: { podcastId } }),
        prisma.creativeOutline.findUniqueOrThrow({ where: { podcastId } }),
      ]);

      const casWrite = await prisma.podcast.updateMany({
        where: { id: podcastId, status: 'FAILED' },
        data: { status: 'SCRIPTING', failedAtStatus: null, failureReason: null },
      });
      if (casWrite.count === 0) {
        return errorResponse('Podcast is no longer in a resumable state', 409);
      }

      await addJob(
        scriptWritingQueue,
        JobType.WRITE_SCRIPT,
        {
          podcastId,
          userId,
          discoveryId: discovery.id,
          dossierId: dossier.id,
          outlineId: outline.id,
          useAdminCredits: useAdminCredits || undefined,
        },
        { jobId: `write-${podcastId}-${Date.now()}` }
      );
      return NextResponse.json({
        success: true,
        message: 'Generation resumed from script writing',
        resumedAt: 'WRITE_SCRIPT',
      });
    }

    case 'COMPILE_SCRIPT': {
      const casCompile = await prisma.podcast.updateMany({
        where: { id: podcastId, status: 'FAILED' },
        data: { status: 'COMPILING', failedAtStatus: null, failureReason: null },
      });
      if (casCompile.count === 0) {
        return errorResponse('Podcast is no longer in a resumable state', 409);
      }

      await addJob(
        compileScriptQueue,
        JobType.COMPILE_SCRIPT,
        {
          podcastId,
          userId,
        },
        { jobId: `compile-${podcastId}-${Date.now()}` }
      );
      return NextResponse.json({
        success: true,
        message: 'Generation resumed from script compilation',
        resumedAt: 'COMPILE_SCRIPT',
      });
    }

    case 'SCRIPT_READY': {
      // Delete stale segments and versions
      await prisma.podcastVersionSegment.deleteMany({
        where: { version: { podcastId } },
      });
      await prisma.podcastVersion.deleteMany({ where: { podcastId } });
      await prisma.segment.deleteMany({ where: { podcastId } });
      // Clear stale voice assignments — re-approval will assign fresh voices
      // for whatever provider the user picks
      await prisma.podcastVoice.deleteMany({ where: { podcastId } });

      // Clear TTS provider so user re-enters audio config UI (CAS on FAILED)
      const casReady = await prisma.podcast.updateMany({
        where: { id: podcastId, status: 'FAILED' },
        data: {
          status: 'SCRIPT_READY',
          failedAtStatus: null,
          failureReason: null,
          ttsProvider: null,
          ttsModel: null,
        },
      });
      if (casReady.count === 0) {
        return errorResponse('Podcast is no longer in a resumable state', 409);
      }

      return NextResponse.json({
        success: true,
        message: 'Script is ready for review — approve to continue',
        resumedAt: 'SCRIPT_READY',
      });
    }

    case 'GENERATE_AUDIO': {
      const casAudio = await prisma.podcast.updateMany({
        where: { id: podcastId, status: 'FAILED' },
        data: { status: 'GENERATING_AUDIO', failedAtStatus: null, failureReason: null },
      });
      if (casAudio.count === 0) {
        return errorResponse('Podcast is no longer in a resumable state', 409);
      }

      // Queue audio generation only for pending segments
      const pendingSegments = await prisma.segment.findMany({
        where: { id: { in: resumePoint.pendingSegmentIds } },
        select: { id: true, speaker: true, text: true },
      });

      for (const seg of pendingSegments) {
        const payload: GenerateAudioPayload = {
          podcastId,
          segmentId: seg.id,
          speaker: seg.speaker,
          text: seg.text,
        };
        await addJob(audioGenerationQueue, JobType.GENERATE_AUDIO, payload, {
          jobId: `audio-${podcastId}-${seg.id}-${Date.now()}`,
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
      // Delete stale podcast versions
      await prisma.podcastVersionSegment.deleteMany({
        where: { version: { podcastId } },
      });
      await prisma.podcastVersion.deleteMany({ where: { podcastId } });

      const casStitch = await prisma.podcast.updateMany({
        where: { id: podcastId, status: 'FAILED' },
        data: { status: 'STITCHING', failedAtStatus: null, failureReason: null },
      });
      if (casStitch.count === 0) {
        return errorResponse('Podcast is no longer in a resumable state', 409);
      }

      const payload: StitchAudioPayload = {
        podcastId,
        segmentIds: resumePoint.segmentIds,
      };

      await addJob(audioStitchingQueue, JobType.STITCH_AUDIO, payload, {
        jobId: `stitch-${podcastId}-${Date.now()}`,
      });
      return NextResponse.json({
        success: true,
        message: 'Generation resumed from audio stitching',
        resumedAt: 'STITCH_AUDIO',
      });
    }
  }
}

/**
 * Start or restart the import pipeline.
 */
async function startImport(
  podcastId: string,
  userId: string,
  podcast: {
    importedAudioKey: string | null;
    sttProvider: string | null;
    sttModel: string | null;
    isHumanContent: boolean;
    title: string;
  },
  plan: 'FREE' | 'PRO'
): Promise<NextResponse> {
  if (!podcast.importedAudioKey) {
    return errorResponse('No audio key for import', 400);
  }
  if (!podcast.sttProvider) {
    return errorResponse(
      'Speech-to-text provider is required before restarting an audio import.',
      400,
      {
        code: 'stt_provider_required',
      }
    );
  }

  let sttProvider: SttProviderId;
  let sttApiKey: string;
  let sttModel: string;
  try {
    const resolved = await resolveSttProvider({
      userId,
      requestedProvider: podcast.sttProvider as SttProviderId,
      requestedModel: podcast.sttModel ?? undefined,
      plan,
    });
    sttProvider = resolved.providerId;
    sttApiKey = resolved.apiKey;
    sttModel = resolved.model;
  } catch (err) {
    return errorResponse(
      err instanceof Error
        ? err.message
        : 'No API key available for selected speech-to-text provider.',
      400
    );
  }

  const casImport = await prisma.podcast.updateMany({
    where: { id: podcastId, status: { in: ['PENDING', 'DISCOVERING', 'FAILED'] } },
    data: { status: 'IMPORTING', failedAtStatus: null, failureReason: null },
  });
  if (casImport.count === 0) {
    return errorResponse('Podcast is no longer in a restartable state', 409);
  }

  const importPayload: ImportAudioPayload = {
    podcastId,
    userId,
    audioKey: podcast.importedAudioKey,
    isHumanContent: podcast.isHumanContent,
    generateMetadata: !podcast.title || podcast.title === 'Untitled Import',
    sttProvider,
    sttApiKey,
    sttModel,
  };

  await addJob(audioImportQueue, JobType.IMPORT_AUDIO, importPayload, {
    jobId: `import-${podcastId}-${Date.now()}`,
  });

  return NextResponse.json({ success: true, message: 'Import retry started' });
}
