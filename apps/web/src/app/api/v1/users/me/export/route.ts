import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
export async function GET(request: NextRequest) {
  const authed = await authenticateRequest(request);
  if (!authed) {
    return errorResponse('Unauthorized', 401);
  }

  const userId = authed.userId;

  const [
    user,
    interests,
    episodes,
    scripts,
    discoveries,
    discoveryMessages,
    interactions,
    saves,
    feedback,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        handle: true,
        image: true,
        role: true,
        voicePreferences: { select: { speaker: true, voiceId: true, sortOrder: true } },
        preferredLanguage: true,
        createdAt: true,
      },
    }),
    prisma.userInterest.findMany({
      where: { userId },
      select: { tagId: true, source: true, weight: true, createdAt: true },
    }),
    prisma.episode.findMany({
      where: { userId },
      select: {
        id: true,
        title: true,
        topic: true,
        status: true,
        source: true,
        visibility: true,
        duration: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.script.findMany({
      where: { episode: { userId } },
      select: {
        episodeId: true,
        turns: true,
        version: true,
        createdAt: true,
      },
    }),
    prisma.discovery.findMany({
      where: { episode: { userId } },
      select: {
        episodeId: true,
        topic: true,
        depth: true,
        audienceLevel: true,
        audience: true,
        focusAreas: true,
        tone: true,
        durationTarget: true,
        priorKnowledge: true,
        sourceUrl: true,
        createdAt: true,
      },
    }),
    prisma.discoveryMessage.findMany({
      where: { discovery: { episode: { userId } } },
      select: {
        discoveryId: true,
        role: true,
        content: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.interaction.findMany({
      where: { userId },
      select: {
        episodeId: true,
        question: true,
        timestamp: true,
        answer: true,
        status: true,
        resolved: true,
        incorporated: true,
        createdAt: true,
      },
    }),
    prisma.save.findMany({
      where: { userId },
      select: { episodeId: true, createdAt: true },
    }),
    prisma.feedback.findMany({
      where: { userId },
      select: {
        type: true,
        rating: true,
        subject: true,
        message: true,
        context: true,
        createdAt: true,
      },
    }),
  ]);

  if (!user) {
    return errorResponse('User not found', 404);
  }

  const exportData = {
    exportedAt: new Date().toISOString(),
    user,
    interests,
    episodes,
    scripts,
    discoveries,
    discoveryMessages,
    interactions,
    saves,
    feedback,
  };

  const date = new Date().toISOString().split('T')[0];

  return new NextResponse(JSON.stringify(exportData, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="sotto-export-${date}.json"`,
    },
  });
}
