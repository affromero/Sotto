import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { getAutoModelConfig, setAutoModelConfig } from '@/lib/auto-model-config';
import { z } from 'zod';
import { errorResponse } from '@/lib/api-response';

export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const config = await getAutoModelConfig();
  return NextResponse.json(config);
}

const planModelSchema = z.object({
  aiProvider: z.enum(['anthropic', 'openai', 'groq', 'together']).optional(),
  aiModel: z.string().min(1).optional(),
  ttsProvider: z.enum(['elevenlabs', 'openai', 'cartesia', 'hume', 'fal', 'replicate', 'kittentts']).optional(),
  ttsModel: z.string().min(1).optional(),
  sttProvider: z.enum(['openai', 'elevenlabs', 'groq', 'together', 'deepgram', 'assemblyai']).optional(),
  sttModel: z.string().min(1).optional(),
});

const platformSchema = z.object({
  aiProvider: z.enum(['anthropic', 'openai', 'groq', 'together']).optional(),
  aiModel: z.string().min(1).optional(),
});

const includedModelsField = z.array(z.string().min(1)).nullable().optional();

function validateSubset(
  freeList: string[] | null | undefined,
  proList: string[] | null | undefined,
  freePath: string,
  ctx: z.RefinementCtx
) {
  if (freeList && proList) {
    const proSet = new Set(proList);
    for (const modelId of freeList) {
      if (!proSet.has(modelId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Free model "${modelId}" must also be in ${freePath.replace('free', 'pro')}`,
          path: [freePath],
        });
      }
    }
  }
}

const updateSchema = z
  .object({
    free: planModelSchema.optional(),
    pro: planModelSchema.optional(),
    platform: platformSchema.optional(),
    freeIncludedModels: includedModelsField,
    proIncludedModels: includedModelsField,
    freeIncludedTtsModels: includedModelsField,
    proIncludedTtsModels: includedModelsField,
    freeIncludedSttModels: includedModelsField,
    proIncludedSttModels: includedModelsField,
  })
  .superRefine((data, ctx) => {
    validateSubset(data.freeIncludedModels, data.proIncludedModels, 'freeIncludedModels', ctx);
    validateSubset(data.freeIncludedTtsModels, data.proIncludedTtsModels, 'freeIncludedTtsModels', ctx);
    validateSubset(data.freeIncludedSttModels, data.proIncludedSttModels, 'freeIncludedSttModels', ctx);
  });

export async function PATCH(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  await setAutoModelConfig(parsed.data, adminId);
  const updated = await getAutoModelConfig();
  return NextResponse.json(updated);
}
