import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { updateAvatarImageShareSchema } from '@/lib/validations';
import { errorResponse } from '@/lib/api-response';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const { id } = await params;

  const body = await request.json();
  const parsed = updateAvatarImageShareSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.errors[0].message, 400);
  }

  const { status: newStatus } = parsed.data;

  const share = await prisma.avatarImageShare.findUnique({
    where: { id },
    include: {
      avatarImage: { select: { name: true } },
      requester: { select: { id: true, name: true } },
    },
  });

  if (!share) {
    return errorResponse('Share request not found', 404);
  }

  // Only the image owner can update
  if (share.imageOwnerId !== session.user.id) {
    return errorResponse('Forbidden', 403);
  }

  // Validate state transitions
  const validTransitions: Record<string, string[]> = {
    PENDING: ['APPROVED', 'DENIED'],
    APPROVED: ['REVOKED'],
  };

  const allowed = validTransitions[share.status] || [];
  if (!allowed.includes(newStatus)) {
    return errorResponse(`Cannot change status from ${share.status} to ${newStatus}`, 400);
  }

  const updated = await prisma.avatarImageShare.update({
    where: { id },
    data: { status: newStatus },
  });

  // Send notification to requester
  const notificationMap: Record<
    string,
    { type: 'AVATAR_IMAGE_REQUEST_APPROVED' | 'AVATAR_IMAGE_REQUEST_DENIED' | 'AVATAR_IMAGE_REQUEST_REVOKED'; title: string; message: string }
  > = {
    APPROVED: {
      type: 'AVATAR_IMAGE_REQUEST_APPROVED',
      title: 'Avatar Image Request Approved',
      message: `Your request to use "${share.avatarImage.name}" has been approved.`,
    },
    DENIED: {
      type: 'AVATAR_IMAGE_REQUEST_DENIED',
      title: 'Avatar Image Request Denied',
      message: `Your request to use "${share.avatarImage.name}" has been denied.`,
    },
    REVOKED: {
      type: 'AVATAR_IMAGE_REQUEST_REVOKED',
      title: 'Avatar Image Access Revoked',
      message: `Your access to "${share.avatarImage.name}" has been revoked.`,
    },
  };

  const notif = notificationMap[newStatus];
  if (notif) {
    await prisma.notification.create({
      data: {
        userId: share.requesterId,
        type: notif.type,
        title: notif.title,
        message: notif.message,
        data: { avatarImageShareId: share.id, avatarImageId: share.avatarImageId },
      },
    });
  }

  return NextResponse.json(updated);
}
