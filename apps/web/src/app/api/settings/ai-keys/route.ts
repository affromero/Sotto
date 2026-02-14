import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { storeAiKey, removeAiKey, listAiProviders, validateAiKey } from '@/lib/byok';
import { isValidAiProviderId } from '@/lib/providers/ai-registry';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const keys = await listAiProviders(session.user.id);
  return NextResponse.json({ keys });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { provider, apiKey } = body;

  if (!provider || !isValidAiProviderId(provider)) {
    return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
  }
  if (!apiKey || typeof apiKey !== 'string' || apiKey.length < 10 || apiKey.length > 500) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 400 });
  }

  const isValid = await validateAiKey(provider, apiKey);
  if (!isValid) {
    return NextResponse.json(
      { error: `Invalid ${provider} API key. Please check and try again.` },
      { status: 422 }
    );
  }

  await storeAiKey(session.user.id, provider, apiKey);
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let provider: string | undefined;
  try {
    const body = await request.json();
    provider = body.provider;
  } catch {
    return NextResponse.json({ error: 'Provider required' }, { status: 400 });
  }

  if (!provider || !isValidAiProviderId(provider)) {
    return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
  }

  await removeAiKey(session.user.id, provider);
  return NextResponse.json({ success: true });
}
