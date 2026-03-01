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

const updateSchema = z
  .object({
    free: planModelSchema.optional(),
    pro: planModelSchema.optional(),
    platform: platformSchema.optional(),
    freeIncludedModels: z.array(z.string().min(1)).nullable().optional(),
    proIncludedModels: z.array(z.string().min(1)).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    const freeList = data.freeIncludedModels;
    const proList = data.proIncludedModels;

    // Cross-field: free models must be a subset of pro models (when both are non-null)
    if (freeList && proList) {
      const proSet = new Set(proList);
      for (const modelId of freeList) {
        if (!proSet.has(modelId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Free model "${modelId}" must also be in proIncludedModels`,
            path: ['freeIncludedModels'],
          });
        }
      }
    }
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
