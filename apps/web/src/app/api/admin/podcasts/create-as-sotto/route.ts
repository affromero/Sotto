import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
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
