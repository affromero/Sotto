import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import {
  getBriefingConfig,
  resolveBriefingConfig,
  fetchAndFilterArticles,
  createBriefingPodcast,
  type BriefingWithUser,
} from '@/lib/briefing-generator';
import { NextResponse } from 'next/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await authenticateRequest(request);
  if (!authResult) return errorResponse('Unauthorized', 401);

  const { id } = await params;

  const briefing = await prisma.userBriefing.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          preferredAiModel: true,
          preferredTtsProvider: true,
          preferredTtsModel: true,
          bannedAt: true,
          interests: {
            select: { tag: { select: { slug: true } } },
          },
        },
      },
    },
  });

  if (!briefing || briefing.userId !== authResult.userId) {
    return errorResponse('Not found', 404);
  }

  if (briefing.user.bannedAt) {
    return errorResponse('Account suspended', 403);
  }

  const adminConfig = await getBriefingConfig();
  const resolved = resolveBriefingConfig(briefing, briefing.user, adminConfig);
  const interestSlugs = briefing.user.interests.map((i) => i.tag.slug);

  const articles = await fetchAndFilterArticles(briefing.id, interestSlugs, adminConfig);
  if (articles.length === 0) {
    return errorResponse('No fresh articles available. Try again later.', 422);
  }

  // Idempotency: return existing podcast if it's still processing or ready
  const today = new Date().toISOString().slice(0, 10);
  const existing = await prisma.briefingLog.findUnique({
    where: { userBriefingId_scheduledDate: { userBriefingId: id, scheduledDate: today } },
    select: { podcastId: true, podcast: { select: { status: true } } },
  });

  if (existing && existing.podcast.status !== 'FAILED') {
    return NextResponse.json({ podcastId: existing.podcastId, alreadyGenerated: true });
  }

  // If previous attempt failed, delete the old log so a new one can be created
  if (existing) {
    await prisma.briefingLog.delete({
      where: { userBriefingId_scheduledDate: { userBriefingId: id, scheduledDate: today } },
    });
  }

  try {
    const result = await createBriefingPodcast(
      briefing as BriefingWithUser,
      resolved,
      articles,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    // Handle unique constraint violation (race condition)
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      const race = await prisma.briefingLog.findUnique({
        where: { userBriefingId_scheduledDate: { userBriefingId: id, scheduledDate: today } },
        select: { podcastId: true },
      });
      if (race) {
        return NextResponse.json({ podcastId: race.podcastId, alreadyGenerated: true });
      }
    }
    throw error;
  }
}
