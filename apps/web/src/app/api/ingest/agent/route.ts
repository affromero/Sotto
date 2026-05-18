import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { agentIngestionSchema } from '@/lib/validations';
import { checkRateLimit } from '@/lib/redis';
import { checkGenerationGate } from '@/lib/generation-gate';
import { checkSuspension, requireAdmin } from '@/lib/auth-guards';
import { getJobPriority, isModelAllowedForUser } from '@/lib/tier-features';
import {
  getModelRequiredPlan,
  getProviderForModel,
  isValidModelId,
} from '@/lib/providers/ai-registry';
import { addJob, contentExtractionQueue, JobType } from '@/lib/queue';
import type { ExtractContentPayload } from '@/lib/queue';
import { generatePodcastSlug } from '@/lib/slugify';
import { errorResponse } from '@/lib/api-response';

function contentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as Record<string, unknown>).code === 'P2002'
  );
}

function formatAgentSourceContent(input: {
  provider: string;
  name: string;
  model?: string;
  runId?: string;
  sourceUrl?: string;
  content: string;
}): string {
  const header = [
    '# Agent Output',
    `Provider: ${input.provider}`,
    `Agent: ${input.name}`,
    ...(input.model ? [`Model: ${input.model}`] : []),
    ...(input.runId ? [`Run ID: ${input.runId}`] : []),
    ...(input.sourceUrl ? [`Source URL: ${input.sourceUrl}`] : []),
  ];

  return `${header.join('\n')}\n\n${input.content}`;
}

function buildSourceMetadata(input: {
  provider: string;
  name: string;
  model?: string;
  runId?: string;
  sourceUrl?: string;
  idempotencyKey?: string;
  hash: string;
}): Prisma.InputJsonObject {
  return {
    kind: 'agent-output',
    agent: {
      provider: input.provider,
      name: input.name,
      ...(input.model ? { model: input.model } : {}),
      ...(input.runId ? { runId: input.runId } : {}),
    },
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    contentHash: input.hash,
    submittedAt: new Date().toISOString(),
  };
}

async function findExistingIngestion(userId: string, idempotencyKey: string) {
  return prisma.agentIngestion.findUnique({
    where: {
      userId_idempotencyKey: {
        userId,
        idempotencyKey,
      },
    },
    select: {
      podcast: {
        select: {
          id: true,
          status: true,
        },
      },
    },
  });
}

export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const authHeader = request.headers.get('authorization');
  const isApiKeyAuth = authHeader?.startsWith('Bearer ') ?? false;

  if (!isApiKeyAuth) {
    const { auth } = await import('@/lib/auth');
    const session = await auth();
    if (session) {
      const suspended = checkSuspension(session);
      if (suspended) return suspended;
    }
  }

  const body: unknown = await request.json();
  const parsed = agentIngestionSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const input = parsed.data;

  if (input.aiModel && !input.aiModel.startsWith('claude-code:')) {
    if (!isValidModelId(input.aiModel)) {
      return errorResponse(
        `Unknown AI model: "${input.aiModel}". Check /api/ai-models for available models.`,
        400
      );
    }
  }

  const existing = input.idempotencyKey
    ? await findExistingIngestion(authResult.userId, input.idempotencyKey)
    : null;
  if (existing) {
    return NextResponse.json(
      {
        id: existing.podcast.id,
        status: existing.podcast.status,
        source: 'AGENT',
        idempotent: true,
      },
      { status: 200 }
    );
  }

  const adminId = await requireAdmin();
  const isAdmin = adminId !== null;

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

  const gate = await checkGenerationGate(authResult.userId);
  if (!gate.allowed) {
    if (gate.reason === 'generation_in_progress') {
      return errorResponse(
        'You already have a podcast being generated. Please wait for it to finish.',
        403,
        { code: gate.reason }
      );
    }

    if (gate.reason === 'daily_limit_reached') {
      const resetH = gate.resetInSeconds ? Math.ceil(gate.resetInSeconds / 3600) : 24;
      return errorResponse(
        `Daily podcast limit reached. Next podcast available in ~${resetH}h.`,
        403,
        { code: gate.reason, resetInSeconds: gate.resetInSeconds }
      );
    }

    return errorResponse(
      'No voice provider available. Add a TTS key in Settings before ingesting agent output.',
      403,
      { code: gate.reason }
    );
  }

  if (input.aiModel) {
    const requiredPlan = getModelRequiredPlan(input.aiModel);
    if (
      requiredPlan &&
      !isModelAllowedForUser(
        requiredPlan,
        gate.isProUser ? 'PRO' : 'FREE',
        gate.isByokUser,
        isAdmin ? 'ADMIN' : undefined
      )
    ) {
      return errorResponse('This model requires a Pro subscription.', 403, {
        code: 'model_requires_pro',
      });
    }
  }

  const hash = contentHash(input.content);
  const aiProvider = input.aiModel?.startsWith('claude-code:')
    ? 'claude-code'
    : input.aiModel
      ? (getProviderForModel(input.aiModel) ?? null)
      : null;
  const sourceContent = formatAgentSourceContent({
    provider: input.agent.provider,
    name: input.agent.name,
    model: input.agent.model,
    runId: input.agent.runId,
    sourceUrl: input.sourceUrl,
    content: input.content,
  });
  const sourceMetadata = buildSourceMetadata({
    provider: input.agent.provider,
    name: input.agent.name,
    model: input.agent.model,
    runId: input.agent.runId,
    sourceUrl: input.sourceUrl,
    idempotencyKey: input.idempotencyKey,
    hash,
  });
  const topic = input.topic ?? input.title;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const podcast = await tx.podcast.create({
        data: {
          userId: authResult.userId,
          title: input.title,
          topic,
          status: 'EXTRACTING',
          source: 'AGENT',
          sourcePlatform: input.agent.provider,
          visibility: 'PRIVATE',
          aiProvider,
          aiModel: input.aiModel ?? null,
          ttsProvider: input.ttsProvider,
          ttsModel: input.ttsModel ?? null,
        },
      });

      const discovery = await tx.discovery.create({
        data: {
          podcastId: podcast.id,
          userId: authResult.userId,
          topic,
          depth: input.depth ?? 'standard',
          audienceLevel: input.audienceLevel ?? 'general',
          focusAreas: input.focusAreas ?? [],
          tone: input.tone ?? 'casual',
          durationTarget: input.durationTarget ?? 10,
          sourceUrl: input.sourceUrl,
          sourceContent,
          sourceMetadata,
        },
      });

      await tx.agentIngestion.create({
        data: {
          userId: authResult.userId,
          podcastId: podcast.id,
          idempotencyKey: input.idempotencyKey ?? null,
          provider: input.agent.provider,
          agentName: input.agent.name,
          runId: input.agent.runId ?? null,
          contentHash: hash,
          metadata: sourceMetadata,
        },
      });

      return { podcast, discovery };
    });

    const slug = await generatePodcastSlug(input.title, authResult.userId, prisma);
    if (slug) {
      await prisma.podcast.update({ where: { id: created.podcast.id }, data: { slug } });
    }

    const payload: ExtractContentPayload = {
      podcastId: created.podcast.id,
      userId: authResult.userId,
      sourceText: sourceContent,
    };
    const jobPriority = getJobPriority(gate.isProUser ? 'PRO' : 'FREE', gate.isByokUser);
    await addJob(contentExtractionQueue, JobType.EXTRACT_CONTENT, payload, {
      priority: jobPriority,
      jobId: `agent-ingest-${created.podcast.id}`,
    });

    return NextResponse.json(
      {
        id: created.podcast.id,
        status: created.podcast.status,
        source: 'AGENT',
        discoveryId: created.discovery.id,
      },
      { status: 201 }
    );
  } catch (error) {
    if (input.idempotencyKey && isUniqueConstraintError(error)) {
      const duplicate = await findExistingIngestion(authResult.userId, input.idempotencyKey);
      if (duplicate) {
        return NextResponse.json(
          {
            id: duplicate.podcast.id,
            status: duplicate.podcast.status,
            source: 'AGENT',
            idempotent: true,
          },
          { status: 200 }
        );
      }
    }

    throw error;
  }
}
