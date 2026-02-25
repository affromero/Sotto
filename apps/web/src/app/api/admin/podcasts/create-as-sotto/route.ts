import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
export async function POST(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  // Find the @sotto system user
  const sottoUser = await prisma.user.findUnique({
    where: { handle: 'sotto' },
    select: { id: true },
  });

  if (!sottoUser) {
    return errorResponse('@sotto system account not found. Run prisma db seed.', 404);
  }

  const body = await request.json();
  const { title, topic } = body;

  if (!title || !topic) {
    return errorResponse('title and topic are required', 400);
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
