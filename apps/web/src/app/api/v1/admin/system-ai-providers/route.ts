import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth-guards';
import {
  SYSTEM_AI_PROVIDER_IDS,
  resolveDisabledSystemAiProviders,
  setSystemAiProviderEnabled,
  getAutoModelConfig,
} from '@/lib/auto-model-config';
import { errorResponse } from '@/lib/api-response';

const updateSchema = z.object({
  providerId: z.enum(SYSTEM_AI_PROVIDER_IDS),
  enabled: z.boolean(),
});

export async function PATCH(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('Invalid system AI provider update', 400, {
      details: parsed.error.flatten(),
    });
  }

  try {
    await setSystemAiProviderEnabled(parsed.data.providerId, parsed.data.enabled, adminId);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Failed to update provider', 400);
  }

  const config = await getAutoModelConfig();
  return NextResponse.json({
    success: true,
    disabledProviders: [...resolveDisabledSystemAiProviders(config)],
  });
}
