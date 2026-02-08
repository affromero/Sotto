import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createPodcastSchema } from '@/lib/validations';

export async function GET(_request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const podcasts = await prisma.podcast.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    include: {
      tags: { include: { tag: true } },
    },
  });

  return NextResponse.json(podcasts);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const parsed = createPodcastSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const podcast = await prisma.podcast.create({
    data: {
      userId: session.user.id,
      title: parsed.data.title,
      topic: parsed.data.topic,
      status: 'PENDING',
    },
  });

  return NextResponse.json(podcast, { status: 201 });
}
