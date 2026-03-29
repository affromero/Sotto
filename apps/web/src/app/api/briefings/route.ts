import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import { computeNextRunAt } from '@/lib/briefing-generator';

const MAX_BRIEFINGS = 5;
const MAX_ENABLED = 3;

const createBriefingSchema = z.object({
  name: z.string().min(1).max(100),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  timezone: z.string().min(1).max(100),
  days: z.number().int().min(0).max(127).default(127),
  enabled: z.boolean().default(true),
  prompt: z.string().max(2000).nullable().optional(),
  depth: z.enum(['eli5', 'quick_overview', 'standard', 'deep_dive']).nullable().optional(),
  tone: z.enum(['casual', 'professional', 'socratic', 'comedic', 'satirical', 'storytelling']).nullable().optional(),
  audienceLevel: z.enum(['beginner', 'intermediate', 'expert']).nullable().optional(),
  duration: z.number().int().min(1).max(40).nullable().optional(),
  format: z.number().int().min(1).max(4).default(2),
  aiModel: z.string().max(100).nullable().optional(),
  ttsProvider: z.string().max(100).nullable().optional(),
  ttsModel: z.string().max(100).nullable().optional(),
  hostVoiceId: z.string().max(200).nullable().optional(),
  expertVoiceId: z.string().max(200).nullable().optional(),
  visibility: z.enum(['PUBLIC', 'UNLISTED', 'PRIVATE']).default('PRIVATE'),
  useByokKeys: z.boolean().default(false),
});

export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult) return errorResponse('Unauthorized', 401);

  const briefings = await prisma.userBriefing.findMany({
    where: { userId: authResult.userId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      enabled: true,
      time: true,
      timezone: true,
      days: true,
      nextRunAt: true,
      prompt: true,
      depth: true,
      tone: true,
      audienceLevel: true,
      duration: true,
      format: true,
      aiModel: true,
      ttsProvider: true,
      ttsModel: true,
      hostVoiceId: true,
      expertVoiceId: true,
      visibility: true,
      useByokKeys: true,
      lastGeneratedAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    briefings: briefings.map((b) => ({
      ...b,
      nextRunAt: b.nextRunAt?.toISOString() ?? null,
      lastGeneratedAt: b.lastGeneratedAt?.toISOString() ?? null,
      createdAt: b.createdAt.toISOString(),
    })),
    limits: { max: MAX_BRIEFINGS, maxEnabled: MAX_ENABLED },
  });
}

export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult) return errorResponse('Unauthorized', 401);

  const userId = authResult.userId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  const parsed = createBriefingSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('Validation failed', 400, { details: parsed.error.flatten().fieldErrors });
  }

  // Cap enforcement
  const [totalCount, enabledCount] = await Promise.all([
    prisma.userBriefing.count({ where: { userId } }),
    prisma.userBriefing.count({ where: { userId, enabled: true } }),
  ]);

  if (totalCount >= MAX_BRIEFINGS) {
    return errorResponse(`Maximum of ${MAX_BRIEFINGS} briefings allowed`, 400);
  }

  const data = parsed.data;

  // If trying to create enabled and already at max enabled, force disabled
  const enabled = data.enabled && enabledCount >= MAX_ENABLED ? false : data.enabled;

  const nextRunAt = enabled
    ? computeNextRunAt(data.time, data.timezone, data.days)
    : null;

  const briefing = await prisma.userBriefing.create({
    data: {
      userId,
      name: data.name,
      enabled,
      time: data.time,
      timezone: data.timezone,
      days: data.days,
      nextRunAt,
      prompt: data.prompt ?? null,
      depth: data.depth ?? null,
      tone: data.tone ?? null,
      audienceLevel: data.audienceLevel ?? null,
      duration: data.duration ?? null,
      format: data.format,
      aiModel: data.aiModel ?? null,
      ttsProvider: data.ttsProvider ?? null,
      ttsModel: data.ttsModel ?? null,
      hostVoiceId: data.hostVoiceId ?? null,
      expertVoiceId: data.expertVoiceId ?? null,
      visibility: data.visibility,
      useByokKeys: data.useByokKeys,
    },
    select: {
      id: true,
      name: true,
      enabled: true,
      time: true,
      timezone: true,
      days: true,
      nextRunAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json(
    {
      ...briefing,
      nextRunAt: briefing.nextRunAt?.toISOString() ?? null,
      createdAt: briefing.createdAt.toISOString(),
      forcedDisabled: data.enabled && !enabled,
    },
    { status: 201 },
  );
}
