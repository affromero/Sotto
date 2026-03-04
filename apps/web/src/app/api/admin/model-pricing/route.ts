import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { getCurrentModelPricing } from '@/lib/pricing-metrics';
import { savePricingSnapshots } from '@/lib/pricing-fetcher';
import { refreshPricingFromDb } from '@/lib/pricing';
import { isValidModelId, getProviderForModel, getPricetokenModelInfo } from '@/lib/providers/ai-registry';
import { z } from 'zod';

export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const pricing = await getCurrentModelPricing();
  return NextResponse.json(pricing);
}

const updatePricingSchema = z.object({
  modelId: z.string().min(1),
  inputPerMTok: z.number().positive(),
  outputPerMTok: z.number().positive(),
});

export async function PATCH(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json();
  const parsed = updatePricingSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { modelId, inputPerMTok, outputPerMTok } = parsed.data;

  const ptInfo = getPricetokenModelInfo(modelId);
  if (!isValidModelId(modelId) && !ptInfo) {
    return errorResponse(`Unknown model: "${modelId}"`, 400);
  }

  const provider = getProviderForModel(modelId) ?? ptInfo?.provider;
  if (!provider) {
    return errorResponse(`Cannot determine provider for model: "${modelId}"`, 400);
  }

  await savePricingSnapshots([
    { modelId, provider, inputPerMTok, outputPerMTok, source: 'admin' },
  ]);

  await refreshPricingFromDb();

  const updated = await getCurrentModelPricing();
  return NextResponse.json(updated);
}
