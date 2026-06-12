import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { agentIngestionSchema } from '@/lib/validations';
import { getJobPriority } from '@/lib/generation-features';
import { isValidModelId } from '@/lib/providers/ai-registry';
import {
  createPrivateIngestionEpisode,
  type PrivateIngestionTransaction,
} from '@/lib/private-ingestion';
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
      episode: {
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
        id: existing.episode.id,
        status: existing.episode.status,
        source: 'AGENT',
        idempotent: true,
      },
      { status: 200 }
    );
  }

  const hash = contentHash(input.content);
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
    const created = await createPrivateIngestionEpisode({
      userId: authResult.userId,
      title: input.title,
      topic,
      source: 'AGENT',
      sourcePlatform: input.agent.provider,
      aiModel: input.aiModel,
      ttsProvider: input.ttsProvider,
      ttsModel: input.ttsModel,
      discovery: {
        depth: input.depth,
        audienceLevel: input.audienceLevel,
        focusAreas: input.focusAreas,
        tone: input.tone,
        durationTarget: input.durationTarget,
        sourceUrl: input.sourceUrl,
        sourceContent,
        sourceMetadata,
      },
      jobPriority: getJobPriority(),
      jobIdPrefix: 'agent-ingest',
      writeIngestionRecord: async (tx: PrivateIngestionTransaction, episodeId: string) => {
        await tx.agentIngestion.create({
          data: {
            userId: authResult.userId,
            episodeId,
            idempotencyKey: input.idempotencyKey ?? null,
            provider: input.agent.provider,
            agentName: input.agent.name,
            runId: input.agent.runId ?? null,
            contentHash: hash,
            metadata: sourceMetadata,
          },
        });
      },
    });

    return NextResponse.json(
      {
        id: created.id,
        status: created.status,
        source: created.source,
        discoveryId: created.discoveryId,
      },
      { status: 201 }
    );
  } catch (error) {
    if (input.idempotencyKey && isUniqueConstraintError(error)) {
      const duplicate = await findExistingIngestion(authResult.userId, input.idempotencyKey);
      if (duplicate) {
        return NextResponse.json(
          {
            id: duplicate.episode.id,
            status: duplicate.episode.status,
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
