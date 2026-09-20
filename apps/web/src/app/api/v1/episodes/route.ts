import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { createEpisodeSchema } from '@/lib/validations';
import { checkRateLimit } from '@/lib/redis';
import { admitDurableJob, contentExtractionQueue, JobType } from '@/lib/queue';
import { getAutoModelConfig } from '@/lib/auto-model-config';
import { getGenerationFeatures, getJobPriority } from '@/lib/generation-features';
import { getProviderForModel, isValidModelId } from '@/lib/providers/ai-registry';
import { isUserAdmin } from '@/lib/auth-guards';
import { generateEpisodeSlug } from '@/lib/slugify';
import type { ExtractContentPayload } from '@/lib/queue';

import { errorResponse } from '@/lib/api-response';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { randomUUID } from 'node:crypto';
export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const episodes = await prisma.episode.findMany({
    where: { userId: authResult.userId },
    orderBy: { createdAt: 'desc' },
    include: {
      tags: { include: { tag: true } },
    },
  });

  return NextResponse.json(episodes);
}

export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  // Detect API key auth (Bearer token) vs browser session
  const authHeader = request.headers.get('authorization');
  const isApiKeyAuth = authHeader?.startsWith('Bearer ');

  // Rate limit API key requests (60 requests per minute)
  if (isApiKeyAuth) {
    const rateLimit = await checkRateLimit(`api:create:${authResult.userId}`, 60, 60);
    if (!rateLimit.allowed) {
      return errorResponse('Rate limit exceeded', 429, { resetAt: rateLimit.resetAt });
    }
  }

  const body = await request.json();
  const parsed = createEpisodeSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  // Validate model ID against registry or dynamic CLI model id support.
  if (parsed.data.aiModel) {
    if (!isValidModelId(parsed.data.aiModel)) {
      return errorResponse(
        `Unknown AI model: "${parsed.data.aiModel}". Check /api/ai-models for available models.`,
        400
      );
    }
  }

  // Admin request context — resolve the role for the authenticated principal
  // (Bearer key or session), not the ambient session.
  const isAdmin = await isUserAdmin(authResult);

  const genFeatures = getGenerationFeatures();

  // Speaker count validation — enforce uniform safety cap.
  const requestedSpeakers = parsed.data.metadata?.speakers;
  if (requestedSpeakers && requestedSpeakers.length > genFeatures.maxSpeakers) {
    return errorResponse(
      `Speaker count (${requestedSpeakers.length}) exceeds the maximum of ${genFeatures.maxSpeakers}.`,
      403
    );
  }

  // Duration validation — enforce uniform safety cap.
  const effectiveMaxDuration = isFinite(genFeatures.maxDurationMinutes)
    ? genFeatures.maxDurationMinutes
    : 9999;
  const durationTarget = parsed.data.metadata?.durationTarget;
  if (durationTarget && durationTarget > effectiveMaxDuration) {
    return errorResponse(
      `Requested duration (${durationTarget} min) exceeds the maximum of ${effectiveMaxDuration} min.`,
      400,
      {}
    );
  }

  const requestedAiModel = parsed.data.aiModel;

  let autoResolvedTtsProvider: string | undefined;
  let autoResolvedTtsModel: string | undefined;
  let autoResolvedAiModel: string | undefined;
  let autoResolvedAiProvider: string | undefined;
  const autoConfig = await getAutoModelConfig();
  if (!parsed.data.aiModel) {
    autoResolvedAiModel = autoConfig.model.aiModel;
    autoResolvedAiProvider = autoConfig.model.aiProvider;
  }
  if (!parsed.data.ttsProvider) {
    autoResolvedTtsProvider = autoConfig.model.ttsProvider;
    autoResolvedTtsModel = autoConfig.model.ttsModel;
  }

  // User preference fallback (only when no explicit model was requested)
  if (!requestedAiModel) {
    const userPref = await prisma.user.findUnique({
      where: { id: authResult.userId },
      select: { preferredAiModel: true },
    });
    if (userPref?.preferredAiModel) {
      const prefModel = userPref.preferredAiModel;
      if (isValidModelId(prefModel)) {
        autoResolvedAiModel = prefModel;
        autoResolvedAiProvider = getProviderForModel(prefModel) ?? autoResolvedAiProvider;
      }
    }
  }

  const voiceEntries = parsed.data.voices ?? [];

  const verificationMode = parsed.data.metadata?.verificationMode ?? 'standard';
  const zeroCostVideo = parsed.data.metadata?.zeroCostVideo ?? false;

  if (verificationMode === 'showcase' && !isAdmin) {
    return errorResponse('Showcase verification mode is admin-only.', 403);
  }

  // Compute auto-resolution flags
  const aiAutoResolved = !parsed.data.aiModel && !!autoResolvedAiModel;
  const ttsAutoResolved =
    !parsed.data.ttsProvider && !parsed.data.ttsModel && !!autoResolvedTtsProvider;

  const episodeData = {
    title: parsed.data.title,
    topic: parsed.data.topic,
    status: 'EXTRACTING' as const,
    ttsProvider: parsed.data.ttsProvider ?? autoResolvedTtsProvider ?? null,
    ttsModel: parsed.data.ttsModel ?? autoResolvedTtsModel ?? null,
    aiProvider: parsed.data.aiModel
      ? (getProviderForModel(parsed.data.aiModel) ?? null)
      : (autoResolvedAiProvider ?? null),
    aiModel: parsed.data.aiModel ?? autoResolvedAiModel ?? null,
    visibility: parsed.data.visibility ?? ('PRIVATE' as const),
    aiAutoResolved,
    ttsAutoResolved,
    verificationMode,
    zeroCostVideo,
    ...(isApiKeyAuth && { source: 'API' as const }),
  };

  const episodeId = randomUUID();
  const sourceUrl = parsed.data.metadata?.sourceUrl;
  const sourceText = parsed.data.metadata?.sourceContent;
  const payload: ExtractContentPayload = {
    episodeId,
    userId: authResult.userId,
    sourceUrl: sourceUrl ?? undefined,
    sourceText: sourceText ?? undefined,
  };
  const jobPriority = getJobPriority();
  await admitDurableJob(contentExtractionQueue, JobType.EXTRACT_CONTENT, payload, {
    jobId: `extract-${episodeId}`,
    priority: jobPriority,
    authorize: async (database) => {
      await requireOriginalSottoAdmission(database, request, authResult);
      return { userId: authResult.userId };
    },
    mutate: async (database, operationId) => {
      await database.episode.create({
        data: {
          id: episodeId,
          ...episodeData,
          userId: authResult.userId,
          pipelineGeneration: operationId,
        },
      });
      const slug = await generateEpisodeSlug(parsed.data.title, authResult.userId, database);
      if (slug) await database.episode.update({ where: { id: episodeId }, data: { slug } });
      if (voiceEntries.length > 0)
        await database.episodeVoice.createMany({
          data: voiceEntries.map((voice) => ({
            episodeId,
            speaker: voice.speaker,
            voiceId: voice.voiceId ?? null,
            provider: parsed.data.ttsProvider ?? autoResolvedTtsProvider ?? null,
          })),
        });
      const metadata = parsed.data.metadata;
      await database.discovery.create({
        data: metadata
          ? {
              topic: metadata.topic,
              depth: metadata.depth,
              audienceLevel: metadata.audienceLevel,
              audience: metadata.audience,
              focusAreas: metadata.focusAreas ?? [],
              tone: metadata.tone,
              durationTarget: metadata.durationTarget
                ? Math.min(metadata.durationTarget, effectiveMaxDuration)
                : undefined,
              sourceUrl: metadata.sourceUrl,
              sourceContent: metadata.sourceContent,
              speakers: metadata.speakers ?? undefined,
              verificationMode,
              episodeId,
              userId: authResult.userId,
            }
          : {
              episodeId,
              userId: authResult.userId,
              topic: parsed.data.topic,
            },
      });
    },
  });

  return NextResponse.json({ id: episodeId, status: 'EXTRACTING' }, { status: 201 });
}
