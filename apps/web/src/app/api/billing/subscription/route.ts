import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { LIMITS } from '@/lib/stripe';
import { listAiProviders, listByokProviders } from '@/lib/byok';

export async function GET(_request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [aiKeys, ttsKeys] = await Promise.all([
      listAiProviders(session.user.id),
      listByokProviders(session.user.id),
    ]);

    return NextResponse.json({
      tier: 'FREE',
      status: 'ACTIVE',
      byok: {
        ai: aiKeys.map((k) => ({ provider: k.provider, isValid: k.isValid })),
        tts: ttsKeys.map((k) => ({ provider: k.provider, isValid: k.isValid })),
      },
      limits: LIMITS,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch subscription';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
