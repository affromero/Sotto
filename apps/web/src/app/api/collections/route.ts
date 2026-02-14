import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createCollectionSchema } from '@/lib/validations';
import { logger } from '@/lib/logger';

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const collections = await prisma.collection.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      description: true,
      isPublic: true,
      podcastCount: true,
      followerCount: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    collections: collections.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
    })),
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = createCollectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { name, description, isPublic } = parsed.data;

  const collection = await prisma.collection.create({
    data: {
      name,
      description: description ?? null,
      isPublic: isPublic ?? true,
      userId: session.user.id,
    },
    select: {
      id: true,
      name: true,
      description: true,
      isPublic: true,
      podcastCount: true,
      followerCount: true,
      createdAt: true,
    },
  });

  logger.info('Collection created', { collectionId: collection.id, userId: session.user.id });

  return NextResponse.json(
    { ...collection, createdAt: collection.createdAt.toISOString() },
    { status: 201 }
  );
}
