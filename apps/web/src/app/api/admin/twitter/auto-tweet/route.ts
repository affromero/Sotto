import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { manualTweet } from '@/lib/twitter-auto-tweet';
import { manualTweetSchema } from '@/lib/validations';

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });
  if (user?.role !== 'ADMIN') return null;
  return session.user.id;
}

export async function GET(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const limit = parseInt(request.nextUrl.searchParams.get('limit') || '20', 10);
  const offset = parseInt(request.nextUrl.searchParams.get('offset') || '0', 10);

  const [autoTweets, total] = await Promise.all([
    prisma.twitterAutoTweet.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 50),
      skip: offset,
      include: {
        podcast: { select: { title: true, topic: true } },
      },
    }),
    prisma.twitterAutoTweet.count(),
  ]);

  return NextResponse.json({ autoTweets, total });
}

export async function POST(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const parsed = manualTweetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: parsed.data.podcastId },
    select: { id: true, status: true, visibility: true },
  });

  if (!podcast) {
    return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
  }

  if (podcast.status !== 'READY') {
    return NextResponse.json({ error: 'Podcast must be READY to tweet' }, { status: 400 });
  }

  const id = await manualTweet(parsed.data.podcastId);
  return NextResponse.json({ id }, { status: 201 });
}
