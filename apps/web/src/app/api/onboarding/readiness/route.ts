import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { errorResponse } from '@/lib/api-response';
import { listAiProviders, listByokProviders } from '@/lib/byok';
import { prisma } from '@/lib/prisma';
import { buildSetupReadiness } from '@/lib/setup-readiness';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const userId = session.user.id;
  const [user, aiProviders, ttsProviders, privateFeedTokenCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        preferredAiModel: true,
        preferredTtsProvider: true,
      },
    }),
    listAiProviders(userId),
    listByokProviders(userId),
    prisma.privateFeedToken.count({
      where: { userId, revokedAt: null },
    }),
  ]);

  const readiness = buildSetupReadiness({
    hasDatabase: true,
    hasQueue: Boolean(process.env.REDIS_URL),
    storageProvider: process.env.STORAGE_PROVIDER,
    aiProviders,
    ttsProviders,
    privateFeedTokenCount,
    selectedAiProvider: user?.preferredAiModel,
    selectedTtsProvider: user?.preferredTtsProvider,
  });

  return NextResponse.json(readiness);
}
