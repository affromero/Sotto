import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { getAutoModelConfig, setAutoModelConfig } from '@/lib/auto-model-config';
import { z } from 'zod';
import { errorResponse } from '@/lib/api-response';
import { type AiProviderId, getAiProviderIds, getProviderForModel, isValidModelId } from '@/lib/providers/ai-registry';

const aiProviderEnum = getAiProviderIds().filter(id => id !== 'claude-code') as [AiProviderId, ...AiProviderId[]];

export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const config = await getAutoModelConfig();
  return NextResponse.json(config);
}

const planModelSchema = z.object({
  aiProvider: z.enum(aiProviderEnum).optional(),
  aiModel: z.string().min(1).optional(),
  ttsProvider: z.enum(['elevenlabs', 'openai', 'cartesia', 'hume', 'fal', 'replicate', 'kittentts']).optional(),
  ttsModel: z.string().min(1).optional(),
  sttProvider: z.enum(['openai', 'elevenlabs', 'together', 'deepgram', 'assemblyai']).optional(),
  sttModel: z.string().min(1).optional(),
});

const platformSchema = z.object({
  aiProvider: z.enum(aiProviderEnum).optional(),
  aiModel: z.string().min(1).optional(),
});

const includedModelsField = z.array(z.string().min(1)).nullable().optional();

const updateSchema = z.object({
  free: planModelSchema.optional(),
  pro: planModelSchema.optional(),
  platform: platformSchema.optional(),
  freeIncludedModels: includedModelsField,
  proIncludedModels: includedModelsField,
  freeIncludedTtsModels: includedModelsField,
  proIncludedTtsModels: includedModelsField,
  freeIncludedSttModels: includedModelsField,
  proIncludedSttModels: includedModelsField,
  // Image
  freeImageProvider: z.string().min(1).optional(),
  freeImageModel: z.string().min(1).optional(),
  proImageProvider: z.string().min(1).optional(),
  proImageModel: z.string().min(1).optional(),
  freeIncludedImageModels: includedModelsField,
  proIncludedImageModels: includedModelsField,
  // Video
  freeVideoProvider: z.string().min(1).optional(),
  freeVideoModel: z.string().min(1).optional(),
  proVideoProvider: z.string().min(1).optional(),
  proVideoModel: z.string().min(1).optional(),
  freeIncludedVideoModels: includedModelsField,
  proIncludedVideoModels: includedModelsField,
  // Avatar
  freeAvatarProvider: z.string().min(1).optional(),
  freeAvatarModel: z.string().min(1).optional(),
  proAvatarProvider: z.string().min(1).optional(),
  proAvatarModel: z.string().min(1).optional(),
  freeIncludedAvatarModels: includedModelsField,
  proIncludedAvatarModels: includedModelsField,
  // Daily limits & allocations
  dailyGenerationLimit: z.number().int().min(0).optional(),
  dailyVideoLimit: z.number().int().min(0).optional(),
  dailyVideoLimitPro: z.number().int().min(0).optional(),
  aiAllocations: z.array(z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    quota: z.number().int().min(1),
  })).optional(),
  ttsAllocations: z.array(z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    quota: z.number().int().min(1),
  })).optional(),
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

  // Validate aiModel fields against registry
  for (const block of [parsed.data.free, parsed.data.pro, parsed.data.platform]) {
    if (block?.aiModel && !isValidModelId(block.aiModel)) {
      return errorResponse(`Unknown AI model: "${block.aiModel}". Check /api/ai-models for available models.`, 400);
    }
  }

  // Validate model/provider consistency — reject mismatched pairs
  for (const [label, block] of [['free', parsed.data.free], ['pro', parsed.data.pro], ['platform', parsed.data.platform]] as const) {
    if (!block) continue;
    if (block.aiModel && block.aiProvider) {
      const owner = getProviderForModel(block.aiModel);
      if (owner && owner !== block.aiProvider) {
        return errorResponse(
          `Model "${block.aiModel}" belongs to "${owner}", not "${block.aiProvider}". ` +
          `Either change the model or the provider for ${label}.`, 400
        );
      }
    }
  }

  await setAutoModelConfig(parsed.data, adminId);
  const updated = await getAutoModelConfig();
  return NextResponse.json(updated);
}
