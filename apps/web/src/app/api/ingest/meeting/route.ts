import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { meetingIngestionSchema } from '@/lib/validations';
import { checkRateLimit } from '@/lib/redis';
import { checkGenerationGate } from '@/lib/generation-gate';
import { checkSuspension, requireAdmin } from '@/lib/auth-guards';
import { getJobPriority, isModelAllowedForUser } from '@/lib/tier-features';
import { getModelRequiredPlan, isValidModelId } from '@/lib/providers/ai-registry';
import {
  createPrivateIngestionPodcast,
  type PrivateIngestionTransaction,
} from '@/lib/private-ingestion';
import { errorResponse } from '@/lib/api-response';

function transcriptHash(transcript: string): string {
  return crypto.createHash('sha256').update(transcript).digest('hex');
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as Record<string, unknown>).code === 'P2002'
  );
}

function formatMeetingSourceContent(input: {
  title: string;
  platform?: string;
  meetingUrl?: string;
  startedAt?: string;
  endedAt?: string;
  participants?: Array<{ name: string; email?: string; role?: string }>;
  actionItems?: string[];
  transcript: string;
}): string {
  const header = [
    '# Meeting Transcript',
    `Meeting: ${input.title}`,
    ...(input.platform ? [`Platform: ${input.platform}`] : []),
    ...(input.startedAt ? [`Started: ${input.startedAt}`] : []),
    ...(input.endedAt ? [`Ended: ${input.endedAt}`] : []),
    ...(input.meetingUrl ? [`Source URL: ${input.meetingUrl}`] : []),
  ];
  const participants =
    input.participants && input.participants.length > 0
      ? [
          '## Participants',
          ...input.participants.map((participant) => {
            const email = participant.email ? ` <${participant.email}>` : '';
            const role = participant.role ? ` (${participant.role})` : '';
            return `- ${participant.name}${email}${role}`;
          }),
        ]
      : [];
  const actionItems =
    input.actionItems && input.actionItems.length > 0
      ? ['## Action Items', ...input.actionItems.map((item) => `- ${item}`)]
      : [];

  return [...header, '', ...participants, '', ...actionItems, '', '## Transcript', input.transcript]
    .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
    .join('\n');
}

function buildSourceMetadata(input: {
  platform?: string;
  meetingUrl?: string;
  startedAt?: string;
  endedAt?: string;
  participants?: Array<{ name: string; email?: string; role?: string }>;
  actionItems?: string[];
  idempotencyKey?: string;
  hash: string;
}): Prisma.InputJsonObject {
  return {
    kind: 'meeting-transcript',
    ...(input.platform ? { platform: input.platform } : {}),
    ...(input.meetingUrl ? { meetingUrl: input.meetingUrl } : {}),
    ...(input.startedAt ? { startedAt: input.startedAt } : {}),
    ...(input.endedAt ? { endedAt: input.endedAt } : {}),
    ...(input.participants ? { participants: input.participants } : {}),
    ...(input.actionItems ? { actionItems: input.actionItems } : {}),
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    transcriptHash: input.hash,
    submittedAt: new Date().toISOString(),
  };
}

async function findExistingIngestion(userId: string, idempotencyKey: string) {
  return prisma.meetingIngestion.findUnique({
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
  const parsed = meetingIngestionSchema.safeParse(body);
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
        source: 'MEETING',
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
      'No voice provider available. Add a TTS key in Settings before ingesting meeting transcripts.',
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

  const hash = transcriptHash(input.transcript);
  const sourceContent = formatMeetingSourceContent({
    title: input.title,
    platform: input.platform,
    meetingUrl: input.meetingUrl,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    participants: input.participants,
    actionItems: input.actionItems,
    transcript: input.transcript,
  });
  const sourceMetadata = buildSourceMetadata({
    platform: input.platform,
    meetingUrl: input.meetingUrl,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    participants: input.participants,
    actionItems: input.actionItems,
    idempotencyKey: input.idempotencyKey,
    hash,
  });
  const topic = input.topic ?? `Meeting recap: ${input.title}`;

  try {
    const created = await createPrivateIngestionPodcast({
      userId: authResult.userId,
      title: input.title,
      topic,
      source: 'MEETING',
      sourcePlatform: input.platform ?? 'meeting-transcript',
      aiModel: input.aiModel,
      ttsProvider: input.ttsProvider,
      ttsModel: input.ttsModel,
      discovery: {
        depth: input.depth,
        audienceLevel: input.audienceLevel,
        focusAreas: input.focusAreas,
        tone: input.tone,
        durationTarget: input.durationTarget,
        sourceUrl: input.meetingUrl,
        sourceContent,
        sourceMetadata,
      },
      jobPriority: getJobPriority(gate.isProUser ? 'PRO' : 'FREE', gate.isByokUser),
      jobIdPrefix: 'meeting-ingest',
      writeIngestionRecord: async (tx: PrivateIngestionTransaction, podcastId: string) => {
        await tx.meetingIngestion.create({
          data: {
            userId: authResult.userId,
            podcastId,
            idempotencyKey: input.idempotencyKey ?? null,
            platform: input.platform ?? null,
            meetingTitle: input.title,
            startedAt: input.startedAt ? new Date(input.startedAt) : null,
            endedAt: input.endedAt ? new Date(input.endedAt) : null,
            transcriptHash: hash,
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
            id: duplicate.podcast.id,
            status: duplicate.podcast.status,
            source: 'MEETING',
            idempotent: true,
          },
          { status: 200 }
        );
      }
    }

    throw error;
  }
}
