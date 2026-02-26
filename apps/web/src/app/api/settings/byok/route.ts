import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { byokSchema } from '@/lib/validations';
import { storeByokKey, removeByokKey, listByokProviders, validateByokKey } from '@/lib/byok';

import { errorResponse } from '@/lib/api-response';
export async function GET(request: NextRequest) {
  const authed = await authenticateRequest(request);
  if (!authed) {
    return errorResponse('Unauthorized', 401);
  }

  const keys = await listByokProviders(authed.userId);
  return NextResponse.json({ keys });
}

export async function POST(request: NextRequest) {
  const authed = await authenticateRequest(request);
  if (!authed) {
    return errorResponse('Unauthorized', 401);
  }

  const body = await request.json();
  const parsed = byokSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('Invalid request', 400, { details: parsed.error.flatten() });
  }

  const { provider, apiKey } = parsed.data;

  const isValid = await validateByokKey(provider, { apiKey });
  if (!isValid) {
    return errorResponse(`Invalid ${provider} credentials. Please check and try again.`, 422);
  }

  await storeByokKey(authed.userId, provider, { apiKey });
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const authed = await authenticateRequest(request);
  if (!authed) {
    return errorResponse('Unauthorized', 401);
  }

  let provider: string | undefined;
  try {
    const body = await request.json();
    provider = body.provider;
  } catch {
    // No body — legacy behavior removes elevenlabs
  }

  const validProviders = ['elevenlabs', 'openai', 'cartesia', 'hume', 'fal', 'replicate'];
  const targetProvider = provider && validProviders.includes(provider) ? provider : 'elevenlabs';

  await removeByokKey(
    authed.userId,
    targetProvider as 'elevenlabs' | 'openai' | 'cartesia' | 'hume' | 'fal' | 'replicate'
  );
  return NextResponse.json({ success: true });
}
