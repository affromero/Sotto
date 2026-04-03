import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import { computeNextRunAt } from '@/lib/briefing-generator';
import { SOTTO_LANGUAGE_CODES } from '@/lib/tts-language-support';

const MAX_ENABLED = 3;

const updateBriefingSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  timezone: z.string().min(1).max(100).optional(),
  days: z.number().int().min(0).max(127).optional(),
  prompt: z.string().max(2000).nullable().optional(),
  depth: z.enum(['eli5', 'quick_overview', 'standard', 'deep_dive']).nullable().optional(),
  tone: z.enum(['casual', 'professional', 'socratic', 'comedic', 'satirical', 'storytelling']).nullable().optional(),
  audienceLevel: z.enum(['beginner', 'intermediate', 'expert']).nullable().optional(),
  duration: z.number().int().min(1).max(40).nullable().optional(),
  format: z.number().int().min(1).max(4).optional(),
  targetLanguage: z.string().refine((v) => SOTTO_LANGUAGE_CODES.has(v), 'Unsupported language').nullable().optional(),
  languageMode: z.enum(['vocabulary_intro', 'conversational_mix', 'full_immersion']).nullable().optional(),
  aiModel: z.string().max(100).nullable().optional(),
  ttsProvider: z.string().max(100).nullable().optional(),
  ttsModel: z.string().max(100).nullable().optional(),
  hostVoiceId: z.string().max(200).nullable().optional(),
  expertVoiceId: z.string().max(200).nullable().optional(),
  continuousLearning: z.boolean().optional(),
  contextEpisodes: z.number().int().min(1).max(5).optional(),
  visibility: z.enum(['PUBLIC', 'UNLISTED', 'PRIVATE']).optional(),
  useByokKeys: z.boolean().optional(),
  zeroCostVideo: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await authenticateRequest(request);
  if (!authResult) return errorResponse('Unauthorized', 401);

  const { id } = await params;

  const briefing = await prisma.userBriefing.findUnique({
    where: { id },
    select: { userId: true, time: true, timezone: true, days: true, enabled: true },
  });

  if (!briefing || briefing.userId !== authResult.userId) {
    return errorResponse('Not found', 404);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  const parsed = updateBriefingSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('Validation failed', 400, { details: parsed.error.flatten().fieldErrors });
  }

  const data = parsed.data;

  // Clear languageMode when targetLanguage is explicitly set to null or English
  if (data.targetLanguage !== undefined && (!data.targetLanguage || data.targetLanguage === 'en')) {
    data.languageMode = null;
  }

  // Cap enforcement for enabling
  if (data.enabled === true && !briefing.enabled) {
    const enabledCount = await prisma.userBriefing.count({
      where: { userId: authResult.userId, enabled: true },
    });
    if (enabledCount >= MAX_ENABLED) {
      return errorResponse(`Maximum of ${MAX_ENABLED} enabled briefings allowed`, 400);
    }
  }

  // Recompute nextRunAt if schedule fields or enabled changed
  const scheduleChanged = data.time !== undefined || data.timezone !== undefined || data.days !== undefined || data.enabled !== undefined;

  let nextRunAt: Date | null | undefined;
  if (scheduleChanged) {
    const newEnabled = data.enabled ?? briefing.enabled;
    if (newEnabled) {
      nextRunAt = computeNextRunAt(
        data.time ?? briefing.time,
        data.timezone ?? briefing.timezone,
        data.days ?? briefing.days,
      );
    } else {
      nextRunAt = null;
    }
  }

  const updated = await prisma.userBriefing.update({
    where: { id },
    data: {
      ...data,
      ...(nextRunAt !== undefined && { nextRunAt }),
    },
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
      targetLanguage: true,
      languageMode: true,
      aiModel: true,
      ttsProvider: true,
      ttsModel: true,
      hostVoiceId: true,
      expertVoiceId: true,
      continuousLearning: true,
      contextEpisodes: true,
      visibility: true,
      useByokKeys: true,
      zeroCostVideo: true,
      lastGeneratedAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    ...updated,
    nextRunAt: updated.nextRunAt?.toISOString() ?? null,
    lastGeneratedAt: updated.lastGeneratedAt?.toISOString() ?? null,
    createdAt: updated.createdAt.toISOString(),
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await authenticateRequest(request);
  if (!authResult) return errorResponse('Unauthorized', 401);

  const { id } = await params;

  const briefing = await prisma.userBriefing.findUnique({
    where: { id },
    select: { userId: true },
  });

  if (!briefing || briefing.userId !== authResult.userId) {
    return errorResponse('Not found', 404);
  }

  await prisma.userBriefing.delete({ where: { id } });

  return NextResponse.json({ deleted: true });
}
