import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { byokProviderSchema, byokSaveSchema } from '@/lib/validations';
import {
  storeByokKey,
  removeByokKey,
  listByokProviders,
  validateByokKey,
  updateByokExtraData,
} from '@/lib/byok';
import type { TtsProviderId } from '@/lib/providers/tts-registry';

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
  const parsed = byokSaveSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('Invalid request', 400, { details: parsed.error.flatten() });
  }

  const { provider, apiKey, userId, adminApiKey, usagePlan, monthlyCreditLimit, billingResetDay } =
    parsed.data;

  const extra: Record<string, string | null> = {
    ...(adminApiKey ? { adminApiKey } : {}),
    ...(usagePlan ? { usagePlan } : {}),
    ...(monthlyCreditLimit ? { monthlyCreditLimit } : {}),
    ...(billingResetDay ? { billingResetDay } : {}),
  };
  if (usagePlan && usagePlan !== 'custom' && !monthlyCreditLimit) {
    extra.monthlyCreditLimit = null;
  }

  if (apiKey) {
    const isValid = await validateByokKey(provider, { apiKey });
    if (!isValid) {
      return errorResponse(`Invalid ${provider} credentials. Please check and try again.`, 422);
    }

    await storeByokKey(authed.userId, provider, {
      apiKey,
      userId,
      extra: Object.fromEntries(
        Object.entries(extra).filter((entry): entry is [string, string] => entry[1] !== null)
      ),
    });
    return NextResponse.json({ success: true });
  }

  const updated = await updateByokExtraData(authed.userId, provider, {
    ...(userId ? { userId } : {}),
    ...extra,
  });
  if (!updated) {
    return errorResponse(`Add a ${provider} API key before saving usage settings.`, 404);
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const authed = await authenticateRequest(request);
  if (!authed) {
    return errorResponse('Unauthorized', 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Provider is required', 400);
  }

  const parsed = byokProviderSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('Invalid request', 400, { details: parsed.error.flatten() });
  }

  await removeByokKey(authed.userId, parsed.data.provider as TtsProviderId | 'suno');
  return NextResponse.json({ success: true });
}
