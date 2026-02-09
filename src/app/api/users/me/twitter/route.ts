import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { twitterSettingsSchema } from '@/lib/validations';
import type { TwitterSettingsData } from '@/types/twitter';

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: {
      twitterHandle: true,
      twitterEnabled: true,
      preferredHostVoiceId: true,
      preferredExpertVoiceId: true,
    },
  });

  const twitterAccount = await prisma.account.findFirst({
    where: { userId: session.user.id, provider: 'twitter' },
    select: { providerAccountId: true },
  });

  const data: TwitterSettingsData = {
    twitterHandle: user.twitterHandle,
    twitterEnabled: user.twitterEnabled,
    preferredHostVoiceId: user.preferredHostVoiceId,
    preferredExpertVoiceId: user.preferredExpertVoiceId,
  };

  return NextResponse.json({
    ...data,
    connected: !!twitterAccount,
  });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const parsed = twitterSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { twitterEnabled, preferredHostVoiceId, preferredExpertVoiceId } = parsed.data;

  const updateData: Record<string, unknown> = {};
  if (twitterEnabled !== undefined) {
    updateData.twitterEnabled = twitterEnabled;
  }
  if (preferredHostVoiceId !== undefined) {
    updateData.preferredHostVoiceId = preferredHostVoiceId;
  }
  if (preferredExpertVoiceId !== undefined) {
    updateData.preferredExpertVoiceId = preferredExpertVoiceId;
  }

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: updateData,
    select: {
      twitterHandle: true,
      twitterEnabled: true,
      preferredHostVoiceId: true,
      preferredExpertVoiceId: true,
    },
  });

  return NextResponse.json(user);
}

export async function DELETE(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Remove Twitter account link and clear settings
  await prisma.$transaction([
    prisma.account.deleteMany({
      where: { userId: session.user.id, provider: 'twitter' },
    }),
    prisma.user.update({
      where: { id: session.user.id },
      data: {
        twitterHandle: null,
        twitterEnabled: false,
      },
    }),
  ]);

  return NextResponse.json({ disconnected: true });
}
