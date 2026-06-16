import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import {
  isValidVisualCueProviderId,
  listVisualCueKeys,
  removeVisualCueKey,
  storeVisualCueKey,
  validateVisualCueKey,
} from '@/lib/visual-cue-keys';

function parseProvider(value: unknown) {
  return typeof value === 'string' && isValidVisualCueProviderId(value) ? value : null;
}

export async function GET(request: NextRequest) {
  const authed = await authenticateRequest(request);
  if (!authed) return errorResponse('Unauthorized', 401);

  const keys = await listVisualCueKeys(authed.userId);
  return NextResponse.json({ keys });
}

export async function POST(request: NextRequest) {
  const authed = await authenticateRequest(request);
  if (!authed) return errorResponse('Unauthorized', 401);

  const body = (await request.json().catch(() => null)) as {
    provider?: unknown;
    apiKey?: unknown;
  } | null;
  const provider = parseProvider(body?.provider);
  const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
  if (!provider) return errorResponse('Invalid visual cue provider', 400);
  if (apiKey.length < 10 || apiKey.length > 500) return errorResponse('Invalid API key', 400);

  const isValid = await validateVisualCueKey(provider, apiKey);
  if (!isValid) {
    return errorResponse(`Invalid ${provider} credentials. Please check and try again.`, 422);
  }

  await storeVisualCueKey(authed.userId, provider, apiKey);
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const authed = await authenticateRequest(request);
  if (!authed) return errorResponse('Unauthorized', 401);

  const body = (await request.json().catch(() => null)) as { provider?: unknown } | null;
  const provider = parseProvider(body?.provider);
  if (!provider) return errorResponse('Invalid visual cue provider', 400);

  await removeVisualCueKey(authed.userId, provider);
  return NextResponse.json({ success: true });
}
