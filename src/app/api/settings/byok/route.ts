import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { byokSchema } from '@/lib/validations';
import { storeByokKey, removeByokKey, listByokProviders, validateByokKey } from '@/lib/byok';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const keys = await listByokProviders(session.user.id);
  return NextResponse.json({ keys });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const parsed = byokSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { provider, apiKey, userId } = parsed.data;

  const isValid = await validateByokKey(provider, { apiKey, userId });
  if (!isValid) {
    return NextResponse.json(
      { error: `Invalid ${provider} credentials. Please check and try again.` },
      { status: 422 }
    );
  }

  await storeByokKey(session.user.id, provider, { apiKey, userId });
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
    // No body — legacy behavior removes elevenlabs
  }

  const validProviders = ['elevenlabs', 'openai', 'playht', 'cartesia', 'hume'];
  const targetProvider = provider && validProviders.includes(provider) ? provider : 'elevenlabs';

  await removeByokKey(
    session.user.id,
    targetProvider as 'elevenlabs' | 'openai' | 'playht' | 'cartesia' | 'hume'
  );
  return NextResponse.json({ success: true });
}
