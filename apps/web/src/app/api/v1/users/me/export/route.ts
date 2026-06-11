import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const userId = session.user.id;

  const [
    user,
    interests,
    podcasts,
    scripts,
    discoveries,
    discoveryMessages,
    interactions,
    saves,
    feedback,
    tasteQuizAnswers,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        handle: true,
        bio: true,
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
    prisma.podcast.findMany({
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
      where: { podcast: { userId } },
      select: {
        podcastId: true,
        turns: true,
        version: true,
        createdAt: true,
      },
    }),
    prisma.discovery.findMany({
      where: { podcast: { userId } },
      select: {
        podcastId: true,
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
      where: { discovery: { podcast: { userId } } },
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
        podcastId: true,
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
      select: { podcastId: true, createdAt: true },
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
    prisma.tasteQuizAnswer.findMany({
      where: { userId },
      select: {
        questionId: true,
        question: true,
        tagSlugs: true,
        response: true,
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
    podcasts,
    scripts,
    discoveries,
    discoveryMessages,
    interactions,
    saves,
    feedback,
    tasteQuizAnswers,
  };

  const date = new Date().toISOString().split('T')[0];

  return new NextResponse(JSON.stringify(exportData, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="sotto-export-${date}.json"`,
    },
  });
}
