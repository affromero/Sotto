import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { byokSchema } from '@/lib/validations';
import { storeByokKey, removeByokKey, hasByokKey, validateElevenLabsKey } from '@/lib/byok';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const hasKey = await hasByokKey(session.user.id);
  return NextResponse.json({ hasKey });
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

  const { apiKey } = parsed.data;

  // Validate the key against ElevenLabs API
  const isValid = await validateElevenLabsKey(apiKey);
  if (!isValid) {
    return NextResponse.json(
      { error: 'Invalid ElevenLabs API key. Please check your key and try again.' },
      { status: 422 }
    );
  }

  await storeByokKey(session.user.id, apiKey);
  return NextResponse.json({ success: true });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await removeByokKey(session.user.id);
  return NextResponse.json({ success: true });
}
