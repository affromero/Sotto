import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { twitterSettingsSchema } from '@/lib/validations';
import type { TwitterSettingsData } from '@/types/twitter';

import { errorResponse } from '@/lib/api-response';
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: {
      twitterHandle: true,
      twitterEnabled: true,
      voicePreferences: { select: { speaker: true, voiceId: true } },
      preferredTtsProvider: true,
      preferredTtsModel: true,
      preferredAiProvider: true,
      preferredAiModel: true,
    },
  });

  const twitterAccount = await prisma.account.findFirst({
    where: { userId: session.user.id, provider: 'twitter' },
    select: { providerAccountId: true },
  });

  const data: TwitterSettingsData = {
    twitterHandle: user.twitterHandle,
    twitterEnabled: user.twitterEnabled,
    voicePreferences: user.voicePreferences,
    preferredTtsProvider: user.preferredTtsProvider,
    preferredTtsModel: user.preferredTtsModel,
    preferredAiProvider: user.preferredAiProvider,
    preferredAiModel: user.preferredAiModel,
  };

  return NextResponse.json({
    ...data,
    connected: !!twitterAccount,
  });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const body = await request.json();
  const parsed = twitterSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('Invalid request', 400, { details: parsed.error.flatten() });
  }

  const {
    twitterEnabled, voicePreferences,
    preferredTtsProvider, preferredTtsModel, preferredAiProvider, preferredAiModel,
  } = parsed.data;

  const updateData: Record<string, unknown> = {};
  if (twitterEnabled !== undefined) {
    updateData.twitterEnabled = twitterEnabled;
  }
  if (preferredTtsProvider !== undefined) {
    updateData.preferredTtsProvider = preferredTtsProvider;
  }
  if (preferredTtsModel !== undefined) {
    updateData.preferredTtsModel = preferredTtsModel;
  }
  if (preferredAiProvider !== undefined) {
    updateData.preferredAiProvider = preferredAiProvider;
  }
  if (preferredAiModel !== undefined) {
    updateData.preferredAiModel = preferredAiModel;
  }

  // Update voice preferences if provided
  if (voicePreferences !== undefined) {
    await prisma.userVoicePreference.deleteMany({ where: { userId: session.user.id } });
    if (voicePreferences.length > 0) {
      await prisma.userVoicePreference.createMany({
        data: voicePreferences.map((vp, i) => ({
          userId: session.user.id,
          speaker: vp.speaker,
          voiceId: vp.voiceId,
          sortOrder: i,
        })),
      });
    }
  }

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: updateData,
    select: {
      twitterHandle: true,
      twitterEnabled: true,
      voicePreferences: { select: { speaker: true, voiceId: true } },
      preferredTtsProvider: true,
      preferredTtsModel: true,
      preferredAiProvider: true,
      preferredAiModel: true,
    },
  });

  return NextResponse.json(user);
}

export async function DELETE(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
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
