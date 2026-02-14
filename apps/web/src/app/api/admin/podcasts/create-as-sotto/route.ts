import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Verify current user is ADMIN
  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });

  if (currentUser?.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Find the @sotto system user
  const sottoUser = await prisma.user.findUnique({
    where: { handle: 'sotto' },
    select: { id: true },
  });

  if (!sottoUser) {
    return NextResponse.json(
      { error: '@sotto system account not found. Run prisma db seed.' },
      { status: 404 }
    );
  }

  const body = await request.json();
  const { title, topic } = body;

  if (!title || !topic) {
    return NextResponse.json({ error: 'title and topic are required' }, { status: 400 });
  }

  // Create podcast owned by @sotto
  const podcast = await prisma.podcast.create({
    data: {
      userId: sottoUser.id,
      title,
      topic,
      status: 'PENDING',
      visibility: 'PUBLIC',
      source: 'WEB',
    },
  });

  return NextResponse.json(podcast, { status: 201 });
}
