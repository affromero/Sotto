import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { getFreeTierConfig, setFreeTierConfig } from '@/lib/free-tier-config';
import { z } from 'zod';

import { errorResponse } from '@/lib/api-response';
export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const config = await getFreeTierConfig();
  return NextResponse.json(config);
}

const providerAllocationSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  quota: z.number().int().min(1).max(50),
});

const updateConfigSchema = z.object({
  aiProvider: z.enum(['anthropic', 'openai']).optional(),
  aiModel: z.string().min(1).optional(),
  ttsProvider: z.enum(['elevenlabs', 'openai', 'cartesia', 'hume', 'fal', 'replicate']).optional(),
  ttsModel: z.string().min(1).optional(),
  sttProvider: z.enum(['openai', 'elevenlabs', 'groq', 'together', 'deepgram', 'assemblyai']).optional(),
  sttModel: z.string().min(1).optional(),
  dailyGenerationLimit: z.number().int().min(0).max(100).optional(),
  aiAllocations: z.array(providerAllocationSchema).optional(),
  ttsAllocations: z.array(providerAllocationSchema).optional(),
});

export async function PATCH(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json();
  const parsed = updateConfigSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  // Validate allocation quota sums against dailyGenerationLimit
  const dailyLimit = parsed.data.dailyGenerationLimit;
  if (dailyLimit !== undefined && dailyLimit > 0) {
    const aiSum = parsed.data.aiAllocations?.reduce((sum, a) => sum + a.quota, 0) ?? 0;
    const ttsSum = parsed.data.ttsAllocations?.reduce((sum, a) => sum + a.quota, 0) ?? 0;

    if (aiSum > 0 && aiSum > dailyLimit) {
      return errorResponse(`AI allocation quotas (${aiSum}) exceed daily generation limit (${dailyLimit})`, 400);
    }
    if (ttsSum > 0 && ttsSum > dailyLimit) {
      return errorResponse(`TTS allocation quotas (${ttsSum}) exceed daily generation limit (${dailyLimit})`, 400);
    }
  }

  await setFreeTierConfig(parsed.data, adminId);
  const updated = await getFreeTierConfig();
  return NextResponse.json(updated);
}
