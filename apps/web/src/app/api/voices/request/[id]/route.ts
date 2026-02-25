import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { updateVoiceRequestSchema } from '@/lib/validations';

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
  const parsed = updateVoiceRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.errors[0].message, 400);
  }

  const { status: newStatus } = parsed.data;

  const voiceRequest = await prisma.voiceRequest.findUnique({
    where: { id },
    include: {
      voiceClone: { select: { name: true } },
      requester: { select: { id: true, name: true } },
    },
  });

  if (!voiceRequest) {
    return errorResponse('Voice request not found', 404);
  }

  // Only the voice owner can update
  if (voiceRequest.voiceOwnerId !== session.user.id) {
    return errorResponse('Forbidden', 403);
  }

  // Validate state transitions
  const validTransitions: Record<string, string[]> = {
    PENDING: ['APPROVED', 'DENIED'],
    APPROVED: ['REVOKED'],
  };

  const allowed = validTransitions[voiceRequest.status] || [];
  if (!allowed.includes(newStatus)) {
    return errorResponse(`Cannot change status from ${voiceRequest.status} to ${newStatus}`, 400);
  }

  const updated = await prisma.voiceRequest.update({
    where: { id },
    data: { status: newStatus },
  });

  // Send notification to requester
  const notificationMap: Record<
    string,
    { type: 'VOICE_REQUEST_APPROVED' | 'VOICE_REQUEST_DENIED'; title: string; message: string }
  > = {
    APPROVED: {
      type: 'VOICE_REQUEST_APPROVED',
      title: 'Voice Request Approved',
      message: `Your request to use "${voiceRequest.voiceClone.name}" has been approved.`,
    },
    DENIED: {
      type: 'VOICE_REQUEST_DENIED',
      title: 'Voice Request Denied',
      message: `Your request to use "${voiceRequest.voiceClone.name}" has been denied.`,
    },
    REVOKED: {
      type: 'VOICE_REQUEST_DENIED',
      title: 'Voice Access Revoked',
      message: `Your access to "${voiceRequest.voiceClone.name}" has been revoked.`,
    },
  };

  const notif = notificationMap[newStatus];
  if (notif) {
    await prisma.notification.create({
      data: {
        userId: voiceRequest.requesterId,
        type: notif.type,
        title: notif.title,
        message: notif.message,
        data: { voiceRequestId: voiceRequest.id, voiceCloneId: voiceRequest.voiceCloneId },
      },
    });
  }

  return NextResponse.json(updated);
}
