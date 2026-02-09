import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { VOICE_POOL } from '@/lib/elevenlabs';
import { getUserVoiceCredits } from '@/lib/subscription';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userClones = await prisma.voiceClone.findMany({
    where: { userId: session.user.id },
    select: {
      id: true,
      name: true,
      elevenLabsVoiceId: true,
      sourceType: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const credits = await getUserVoiceCredits(session.user.id);

  return NextResponse.json({
    poolVoices: VOICE_POOL,
    userClones,
    credits,
  });
}
