import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { createCollectionSchema } from '@/lib/validations';
import { logger } from '@/lib/logger';
import { errorResponse } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);

  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const userId = authResult.userId;

  const collections = await prisma.collection.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      description: true,
      isPublic: true,
      podcastCount: true,
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
  const authResult = await authenticateRequest(request);

  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const userId = authResult.userId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  const parsed = createCollectionSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('Validation failed', 400, { details: parsed.error.flatten().fieldErrors });
  }

  const { name, description, isPublic } = parsed.data;

  const collection = await prisma.collection.create({
    data: {
      name,
      description: description ?? null,
      isPublic: isPublic ?? true,
      userId,
    },
    select: {
      id: true,
      name: true,
      description: true,
      isPublic: true,
      podcastCount: true,
      createdAt: true,
    },
  });

  logger.info('Collection created', { collectionId: collection.id, userId });

  return NextResponse.json(
    { ...collection, createdAt: collection.createdAt.toISOString() },
    { status: 201 }
  );
}
