import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createAvatarImageShareSchema } from '@/lib/validations';
import { errorResponse } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const body = await request.json();
  const parsed = createAvatarImageShareSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.errors[0].message, 400);
  }

  const { avatarImageId, message } = parsed.data;

  const avatarImage = await prisma.avatarImage.findUnique({
    where: { id: avatarImageId },
    select: { id: true, shareable: true, userId: true, name: true },
  });

  if (!avatarImage) {
    return errorResponse('Avatar image not found', 404);
  }

  if (!avatarImage.shareable) {
    return errorResponse('This image is not available for sharing', 403);
  }

  if (avatarImage.userId === session.user.id) {
    return errorResponse('You cannot request your own image', 400);
  }

  try {
    const share = await prisma.avatarImageShare.create({
      data: {
        requesterId: session.user.id,
        imageOwnerId: avatarImage.userId,
        avatarImageId,
        message: message || null,
      },
    });

    await prisma.notification.create({
      data: {
        userId: avatarImage.userId,
        type: 'AVATAR_IMAGE_REQUEST_RECEIVED',
        title: 'Avatar Image Request',
        message: `Someone requested to use your avatar image "${avatarImage.name}".`,
        data: { avatarImageShareId: share.id, avatarImageId },
      },
    });

    return NextResponse.json(share, { status: 201 });
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      return errorResponse('You have already requested this image', 409);
    }
    throw err;
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const [sent, received] = await Promise.all([
    prisma.avatarImageShare.findMany({
      where: { requesterId: session.user.id },
      include: {
        avatarImage: { select: { id: true, name: true, imageUrl: true } },
        imageOwner: { select: { id: true, name: true, handle: true, image: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.avatarImageShare.findMany({
      where: { imageOwnerId: session.user.id },
      include: {
        avatarImage: { select: { id: true, name: true, imageUrl: true } },
        requester: { select: { id: true, name: true, handle: true, image: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return NextResponse.json({ sent, received });
}
