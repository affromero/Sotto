import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth-guards';
import { getPlanFeatureConfig, setPlanFeatureConfig } from '@/lib/plan-feature-config';
import { errorResponse } from '@/lib/api-response';

export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const config = await getPlanFeatureConfig();
  return NextResponse.json(config);
}

const planFeaturesSchema = z.object({
  freeVoiceCloningEnabled: z.boolean().optional(),
  proVoiceCloningEnabled: z.boolean().optional(),
  freeVoiceTracksEnabled: z.boolean().optional(),
  proVoiceTracksEnabled: z.boolean().optional(),
  freeMaxVoiceTracks: z.number().int().min(0).optional(),
  proMaxVoiceTracks: z.number().int().min(0).optional(),
  voiceMarketplaceEnabled: z.boolean().optional(),
  avatarUploadsEnabled: z.boolean().optional(),
  avatarGenerationEnabled: z.boolean().optional(),
});

export async function PATCH(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const body = await request.json();
  const parsed = planFeaturesSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.flatten(), 400);

  await setPlanFeatureConfig(parsed.data, adminId);
  const updated = await getPlanFeatureConfig();
  return NextResponse.json(updated);
}
