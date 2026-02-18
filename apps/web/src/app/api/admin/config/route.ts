import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { getFreeTierConfig, setFreeTierConfig } from '@/lib/free-tier-config';
import { z } from 'zod';

export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const config = await getFreeTierConfig();
  return NextResponse.json(config);
}

const updateConfigSchema = z.object({
  aiProvider: z.enum(['anthropic', 'openai']).optional(),
  aiModel: z.string().min(1).optional(),
  ttsProvider: z.enum(['elevenlabs', 'openai', 'playht', 'cartesia', 'hume', 'fal', 'replicate']).optional(),
  ttsModel: z.string().min(1).optional(),
  sttProvider: z.enum(['openai', 'elevenlabs', 'groq']).optional(),
  sttModel: z.string().min(1).optional(),
  generationLimit: z.number().int().min(0).max(100).optional(),
});

export async function PATCH(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const parsed = updateConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await setFreeTierConfig(parsed.data, adminId);
  const updated = await getFreeTierConfig();
  return NextResponse.json(updated);
}
