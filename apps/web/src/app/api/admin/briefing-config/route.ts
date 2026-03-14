import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { getBriefingConfig, setBriefingConfig } from '@/lib/briefing-config';
import { errorResponse } from '@/lib/api-response';

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return errorResponse('Forbidden', 403);
  }
  const config = await getBriefingConfig();
  return NextResponse.json(config);
}

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  defaultAiModel: z.string().nullable().optional(),
  defaultTtsProvider: z.string().nullable().optional(),
  defaultTtsModel: z.string().nullable().optional(),
  maxArticlesPerBriefing: z.number().int().min(1).max(20).optional(),
  targetDurationMinutes: z.number().int().min(1).max(30).optional(),
  maxBriefingsPerBatch: z.number().int().min(1).max(500).optional(),
  pollIntervalMs: z.number().int().min(60000).max(86400000).optional(),
}).strict();

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('Invalid request body', 400);
  }

  await setBriefingConfig(parsed.data, session.user.id);
  const config = await getBriefingConfig();
  return NextResponse.json(config);
}
