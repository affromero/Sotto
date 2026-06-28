import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { getAutoModelConfig, setAutoModelConfig } from '@/lib/auto-model-config';
import { z } from 'zod';
import { errorResponse } from '@/lib/api-response';
import {
  type AiProviderId,
  getAiProviderIds,
  getProviderForModel,
  isValidModelId,
} from '@/lib/providers/ai-registry';
import { getProviderIds, type TtsProviderId } from '@/lib/providers/tts-registry';
import { getSttProviderIds, type SttProviderId } from '@/lib/providers/stt-registry';

const aiProviderEnum = getAiProviderIds() as [AiProviderId, ...AiProviderId[]];
const ttsProviderEnum = getProviderIds() as [TtsProviderId, ...TtsProviderId[]];
const sttProviderEnum = getSttProviderIds() as [SttProviderId, ...SttProviderId[]];

export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const config = await getAutoModelConfig();
  return NextResponse.json(config);
}

const modelSchema = z.object({
  aiProvider: z.enum(aiProviderEnum).optional(),
  aiModel: z.string().min(1).optional(),
  ttsProvider: z.enum(ttsProviderEnum).optional(),
  ttsModel: z.string().min(1).optional(),
  sttProvider: z.enum(sttProviderEnum).optional(),
  sttModel: z.string().min(1).optional(),
});

const platformSchema = z.object({
  aiProvider: z.enum(aiProviderEnum).optional(),
  aiModel: z.string().min(1).optional(),
});

const includedModelsField = z.array(z.string().min(1)).nullable().optional();

const updateSchema = z.object({
  model: modelSchema.optional(),
  platform: platformSchema.optional(),
  includedModels: includedModelsField,
  includedTtsModels: includedModelsField,
  includedSttModels: includedModelsField,
});

export async function PATCH(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(' ');
    return errorResponse(message || 'Invalid model provider configuration', 400, {
      details: parsed.error.flatten(),
    });
  }

  // Validate aiModel fields against registry
  for (const block of [parsed.data.model, parsed.data.platform]) {
    if (block?.aiModel && !isValidModelId(block.aiModel)) {
      return errorResponse(
        `Unknown AI model: "${block.aiModel}". Check /api/ai-models for available models.`,
        400
      );
    }
  }

  // Validate model/provider consistency — reject mismatched pairs
  for (const [label, block] of [
    ['default', parsed.data.model],
    ['platform', parsed.data.platform],
  ] as const) {
    if (!block) continue;
    if (block.aiModel && block.aiProvider) {
      const owner = getProviderForModel(block.aiModel);
      if (owner && owner !== block.aiProvider) {
        return errorResponse(
          `Model "${block.aiModel}" belongs to "${owner}", not "${block.aiProvider}". ` +
            `Either change the model or the provider for ${label}.`,
          400
        );
      }
    }
  }

  await setAutoModelConfig(parsed.data, adminId);
  const updated = await getAutoModelConfig();
  return NextResponse.json(updated);
}
