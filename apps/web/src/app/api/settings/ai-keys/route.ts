import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { storeAiKey, removeAiKey, listAiProviders, validateAiKey } from '@/lib/byok';
import { isValidAiProviderId } from '@/lib/providers/ai-registry';

import { errorResponse } from '@/lib/api-response';
export async function GET(request: NextRequest) {
  const authed = await authenticateRequest(request);
  if (!authed) {
    return errorResponse('Unauthorized', 401);
  }

  const keys = await listAiProviders(authed.userId);
  return NextResponse.json({ keys });
}

export async function POST(request: NextRequest) {
  const authed = await authenticateRequest(request);
  if (!authed) {
    return errorResponse('Unauthorized', 401);
  }

  const body = await request.json();
  const { provider, apiKey } = body;

  if (!provider || !isValidAiProviderId(provider)) {
    return errorResponse('Invalid provider', 400);
  }
  if (!apiKey || typeof apiKey !== 'string' || apiKey.length < 10 || apiKey.length > 500) {
    return errorResponse('Invalid API key', 400);
  }

  const isValid = await validateAiKey(provider, apiKey);
  if (!isValid) {
    return errorResponse(`Invalid ${provider} API key. Please check and try again.`, 422);
  }

  await storeAiKey(authed.userId, provider, apiKey);
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
    return errorResponse('Provider required', 400);
  }

  if (!provider || !isValidAiProviderId(provider)) {
    return errorResponse('Invalid provider', 400);
  }

  await removeAiKey(authed.userId, provider);
  return NextResponse.json({ success: true });
}
