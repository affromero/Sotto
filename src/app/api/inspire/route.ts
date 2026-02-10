import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getPersonalizedTopics, getTrendingTopics, getCurrentEvents } from '@/lib/inspire-engine';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    // Fetch user interests for personalizing current events
    const interests = await prisma.userInterest.findMany({
      where: { userId },
      include: { tag: { select: { name: true } } },
      take: 6,
    });
    const interestNames = interests.map((i) => i.tag.name);

    // Fetch all three sections in parallel
    const [forYou, trending, inTheNews] = await Promise.all([
      getPersonalizedTopics(userId),
      getTrendingTopics(),
      getCurrentEvents(interestNames.length > 0 ? interestNames : undefined),
    ]);

    return NextResponse.json({ forYou, trending, inTheNews });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to get inspiration';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
