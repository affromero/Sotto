import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { requireAdmin } from '@/lib/auth-guards';
import {
  contentExtractionQueue,
  scriptGenerationQueue,
  scriptVerificationQueue,
  referenceValidationQueue,
  audioGenerationQueue,
  audioStitchingQueue,
  audioImportQueue,
  addJob,
  JobType,
} from '@/lib/queue';
import { checkGenerationGate, tryIncrementFreeGeneration } from '@/lib/generation-gate';
import { getTierFeatures } from '@/lib/tier-features';
import { selectFreeTierProviders } from '@/lib/free-tier-provider-selector';
import { checkRateLimit } from '@/lib/redis';
import { getAiKey, getByokKey } from '@/lib/byok';
import { determineResumePoint, type ResumePoint } from '@/lib/pipeline-resume';
import type {
  ExtractContentPayload,
  ImportAudioPayload,
  GenerateScriptPayload,
  VerifyScriptPayload,
  ValidateReferencesPayload,
  GenerateAudioPayload,
  StitchAudioPayload,
} from '@/lib/queue';
import type { SttProviderId } from '@sotto/shared';

type RouteParams = { params: Promise<{ podcastId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(request);

  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
      return NextResponse.json(
        { error: 'Rate limit exceeded: max 20 generations per hour.' },
        { status: 429 }
      );
    }
    const daily = await checkRateLimit(`generate:day:${authResult.userId}`, 100, 86400);
    if (!daily.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded: max 100 generations per day.' },
        { status: 429 }
      );
    }
  }

  // Generation gate: BYOK or free tier (skip for admins)
  const gate = isAdmin
    ? { allowed: true as const, reason: 'admin' as const, isByokUser: true, isProUser: true, freeGenerationsUsed: 0, freeGenerationsLimit: 0, dailyLimit: 0 }
    : await checkGenerationGate(authResult.userId);
  if (!gate.allowed) {
    const msg =
      gate.reason === 'free_tier_exhausted'
        ? 'Free generations used. Add your own API keys to continue.'
        : 'No voice provider available. Add a TTS key in Settings for unlimited generation.';
    return NextResponse.json({ error: msg, code: gate.reason }, { status: 403 });
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
      isHumanContent: true,
      title: true,
      discovery: {
        select: { id: true, sourceUrl: true, sourceContent: true, durationTarget: true },
      },
    },
  });

  if (!podcast) {
    return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
  }

  if (podcast.userId !== authResult.userId && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (
    podcast.status !== 'PENDING' &&
    podcast.status !== 'DISCOVERING' &&
    podcast.status !== 'FAILED'
  ) {
    return NextResponse.json(
      { error: 'Podcast must be in PENDING, DISCOVERING, or FAILED status to generate' },
      { status: 400 }
    );
  }

  // Duration validation — use tier features for duration cap
  const tierFeatures = getTierFeatures(gate.isProUser ? 'PRO' : 'FREE', gate.isByokUser);
  const effectiveMaxDuration = isFinite(tierFeatures.maxDurationMinutes) ? tierFeatures.maxDurationMinutes : 9999;
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

      if (useAdminCredits) {
        const selected = await selectFreeTierProviders(podcast.userId);
        await prisma.podcast.update({
          where: { id: podcastId },
          data: {
            ttsProvider: selected.ttsProvider,
            ttsModel: selected.ttsModel,
            aiModel: selected.aiModel,
          },
        });
      }

      return await routeResume(
        podcastId,
        authResult.userId,
        podcast,
        resumePoint,
        useAdminCredits
      );
    }
  }

  // Imported podcasts re-queue the import pipeline
  if (podcast.source === 'IMPORT' && podcast.importedAudioKey) {
    return await startImport(podcastId, authResult.userId, podcast);
  }

  // Standard generation pipeline: start from scratch
  await prisma.podcast.update({
    where: { id: podcastId },
    data: { status: 'EXTRACTING', failedAtStatus: null, failureReason: null },
  });

  const payload: ExtractContentPayload = {
    podcastId,
    userId: authResult.userId,
    sourceUrl: podcast.discovery?.sourceUrl ?? undefined,
    sourceText: podcast.discovery?.sourceContent ?? undefined,
    useAdminCredits: useAdminCredits || undefined,
  };

  await addJob(contentExtractionQueue, JobType.EXTRACT_CONTENT, payload);

  if (useAdminCredits) {
    // Use platform API keys: write free-tier provider selection, skip counter
    const selected = await selectFreeTierProviders(podcast.userId);
    await prisma.podcast.update({
      where: { id: podcastId },
      data: {
        ttsProvider: selected.ttsProvider,
        ttsModel: selected.ttsModel,
        aiModel: selected.aiModel,
      },
    });
  } else if (!gate.isByokUser) {
    // Increment free tier counter (skip for FAILED retries — already counted)
    const selected = await selectFreeTierProviders(authResult.userId);
    await tryIncrementFreeGeneration(authResult.userId, gate.dailyLimit, {
      ai: { provider: selected.aiProvider, quota: selected.aiQuota },
      tts: { provider: selected.ttsProvider, quota: selected.ttsQuota },
    });
    // Write selected providers onto the podcast
    await prisma.podcast.update({
      where: { id: podcastId },
      data: {
        ttsProvider: selected.ttsProvider,
        ttsModel: selected.ttsModel,
        aiModel: selected.aiModel,
      },
    });
  }

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
    isHumanContent: boolean;
    title: string;
    discovery: { id: string; sourceUrl: string | null; sourceContent: string | null } | null;
  },
  resumePoint: ResumePoint,
  useAdminCredits: boolean
): Promise<NextResponse> {
  switch (resumePoint.step) {
    case 'IMPORT_AUDIO': {
      return await startImport(podcastId, userId, podcast);
    }

    case 'EXTRACT_CONTENT': {
      await prisma.podcast.update({
        where: { id: podcastId },
        data: { status: 'EXTRACTING', failedAtStatus: null, failureReason: null },
      });

      const payload: ExtractContentPayload = {
        podcastId,
        userId,
        sourceUrl: podcast.discovery?.sourceUrl ?? undefined,
        sourceText: podcast.discovery?.sourceContent ?? undefined,
        useAdminCredits: useAdminCredits || undefined,
      };

      await addJob(contentExtractionQueue, JobType.EXTRACT_CONTENT, payload);
      return NextResponse.json({
        success: true,
        message: 'Generation resumed from content extraction',
        resumedAt: 'EXTRACT_CONTENT',
      });
    }

    case 'GENERATE_SCRIPT': {
      // Delete bad script and refs before regenerating
      await prisma.reference.deleteMany({ where: { podcastId } });
      await prisma.script.deleteMany({ where: { podcastId } });

      const discovery = await prisma.discovery.findUniqueOrThrow({
        where: { podcastId },
      });

      await prisma.podcast.update({
        where: { id: podcastId },
        data: { status: 'SCRIPTING', failedAtStatus: null, failureReason: null },
      });

      const payload: GenerateScriptPayload = {
        podcastId,
        userId,
        discoveryId: discovery.id,
        sourceContent: discovery.sourceContent ?? undefined,
        useAdminCredits: useAdminCredits || undefined,
      };

      await addJob(scriptGenerationQueue, JobType.GENERATE_SCRIPT, payload);
      return NextResponse.json({
        success: true,
        message: 'Generation resumed from script generation',
        resumedAt: 'GENERATE_SCRIPT',
      });
    }

    case 'VERIFY_SCRIPT': {
      const discovery = await prisma.discovery.findUniqueOrThrow({
        where: { podcastId },
      });

      await prisma.podcast.update({
        where: { id: podcastId },
        data: { status: 'VERIFYING_SCRIPT', failedAtStatus: null, failureReason: null },
      });

      const payload: VerifyScriptPayload = {
        podcastId,
        userId,
        discoveryId: discovery.id,
        useAdminCredits: useAdminCredits || undefined,
      };

      await addJob(scriptVerificationQueue, JobType.VERIFY_SCRIPT, payload);
      return NextResponse.json({
        success: true,
        message: 'Generation resumed from script verification',
        resumedAt: 'VERIFY_SCRIPT',
      });
    }

    case 'VALIDATE_REFERENCES': {
      await prisma.podcast.update({
        where: { id: podcastId },
        data: { status: 'VALIDATING_REFERENCES', failedAtStatus: null, failureReason: null },
      });

      const payload: ValidateReferencesPayload = {
        podcastId,
        userId,
        useAdminCredits: useAdminCredits || undefined,
      };

      await addJob(referenceValidationQueue, JobType.VALIDATE_REFERENCES, payload);
      return NextResponse.json({
        success: true,
        message: 'Generation resumed from reference validation',
        resumedAt: 'VALIDATE_REFERENCES',
      });
    }

    case 'SCRIPT_READY': {
      // Delete stale segments and versions
      await prisma.podcastVersionSegment.deleteMany({
        where: { version: { podcastId } },
      });
      await prisma.podcastVersion.deleteMany({ where: { podcastId } });
      await prisma.segment.deleteMany({ where: { podcastId } });

      await prisma.podcast.update({
        where: { id: podcastId },
        data: { status: 'SCRIPT_READY', failedAtStatus: null, failureReason: null },
      });

      return NextResponse.json({
        success: true,
        message: 'Script is ready for review — approve to continue',
        resumedAt: 'SCRIPT_READY',
      });
    }

    case 'GENERATE_AUDIO': {
      await prisma.podcast.update({
        where: { id: podcastId },
        data: { status: 'GENERATING_AUDIO', failedAtStatus: null, failureReason: null },
      });

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
        await addJob(audioGenerationQueue, JobType.GENERATE_AUDIO, payload);
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

      await prisma.podcast.update({
        where: { id: podcastId },
        data: { status: 'STITCHING', failedAtStatus: null, failureReason: null },
      });

      const payload: StitchAudioPayload = {
        podcastId,
        segmentIds: resumePoint.segmentIds,
      };

      await addJob(audioStitchingQueue, JobType.STITCH_AUDIO, payload);
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
    isHumanContent: boolean;
    title: string;
  }
): Promise<NextResponse> {
  if (!podcast.importedAudioKey) {
    return NextResponse.json({ error: 'No audio key for import' }, { status: 400 });
  }

  // Resolve STT key — try groq first, then openai, then elevenlabs
  let sttProvider: SttProviderId | undefined;
  let sttApiKey: string | undefined;

  // STT fallback chain: groq → together → openai → deepgram → assemblyai → elevenlabs
  const groqKey = await getAiKey(userId, 'groq');
  if (groqKey?.apiKey || process.env.GROQ_API_KEY) {
    sttProvider = 'groq';
    sttApiKey = groqKey?.apiKey ?? process.env.GROQ_API_KEY;
  } else {
    const togetherKey = await getAiKey(userId, 'together');
    if (togetherKey?.apiKey || process.env.TOGETHER_API_KEY) {
      sttProvider = 'together';
      sttApiKey = togetherKey?.apiKey ?? process.env.TOGETHER_API_KEY;
    } else {
      const openaiKey = await getAiKey(userId, 'openai');
      if (openaiKey?.apiKey || process.env.OPENAI_API_KEY) {
        sttProvider = 'openai';
        sttApiKey = openaiKey?.apiKey ?? process.env.OPENAI_API_KEY;
      } else {
        const dgKey = await getAiKey(userId, 'deepgram');
        if (dgKey?.apiKey || process.env.DEEPGRAM_API_KEY) {
          sttProvider = 'deepgram';
          sttApiKey = dgKey?.apiKey ?? process.env.DEEPGRAM_API_KEY;
        } else {
          const aaiKey = await getAiKey(userId, 'assemblyai');
          if (aaiKey?.apiKey || process.env.ASSEMBLYAI_API_KEY) {
            sttProvider = 'assemblyai';
            sttApiKey = aaiKey?.apiKey ?? process.env.ASSEMBLYAI_API_KEY;
          } else {
            const elKey = await getByokKey(userId, 'elevenlabs');
            if (elKey || process.env.ELEVENLABS_API_KEY) {
              sttProvider = 'elevenlabs';
              sttApiKey = elKey ?? process.env.ELEVENLABS_API_KEY;
            }
          }
        }
      }
    }
  }

  await prisma.podcast.update({
    where: { id: podcastId },
    data: { status: 'IMPORTING', failedAtStatus: null, failureReason: null },
  });

  const importPayload: ImportAudioPayload = {
    podcastId,
    userId,
    audioKey: podcast.importedAudioKey,
    isHumanContent: podcast.isHumanContent,
    generateMetadata: !podcast.title || podcast.title === 'Untitled Import',
    sttProvider,
    sttApiKey,
  };

  await addJob(audioImportQueue, JobType.IMPORT_AUDIO, importPayload);

  return NextResponse.json({ success: true, message: 'Import retry started' });
}
