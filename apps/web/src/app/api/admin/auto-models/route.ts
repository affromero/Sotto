import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { getAutoModelConfig, setAutoModelConfig } from '@/lib/auto-model-config';
import { z } from 'zod';
import { errorResponse } from '@/lib/api-response';
import { isValidModelId } from '@/lib/providers/ai-registry';

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

  await setAutoModelConfig(parsed.data, adminId);
  const updated = await getAutoModelConfig();
  return NextResponse.json(updated);
}
