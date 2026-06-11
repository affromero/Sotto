import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { deleteClonedVoice } from '@/lib/elevenlabs';
import { deleteFile } from '@/lib/r2';
import { z } from 'zod';

import { errorResponse } from '@/lib/api-response';
export async function GET(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const params = request.nextUrl.searchParams;
  const statusFilter = params.get('status');
  const search = params.get('search');
  const page = parseInt(params.get('page') || '1', 10);
  const limit = parseInt(params.get('limit') || '50', 10);
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};

  if (statusFilter) {
    where.verificationStatus = statusFilter;
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { user: { name: { contains: search, mode: 'insensitive' } } },
      { user: { email: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const [voices, total] = await Promise.all([
    prisma.voiceClone.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        provider: true,
        verificationStatus: true,
        createdAt: true,
        user: {
          select: { id: true, name: true, email: true, image: true },
        },
        fingerprint: {
          select: { id: true, modelVersion: true },
        },
        verificationChallenges: {
          select: {
            id: true,
            phrase: true,
            attemptNumber: true,
            similarity: true,
            passed: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        similarityMatchesAs: {
          select: {
            id: true,
            similarity: true,
            blockedVoice: {
              select: { id: true, name: true },
            },
          },
        },
        blockedMatchesAs: {
          select: {
            id: true,
            similarity: true,
            resolution: true,
            matchedVoice: {
              select: { id: true, name: true },
            },
          },
        },
      },
    }),
    prisma.voiceClone.count({ where }),
  ]);

  return NextResponse.json({ voices, total, page, hasMore: skip + limit < total });
}

const adminVoiceActionSchema = z.object({
  voiceCloneId: z.string().min(1),
  action: z.enum(['verify', 'block', 'protect', 'unblock']),
});

export async function PATCH(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json();
  const parsed = adminVoiceActionSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { voiceCloneId, action } = parsed.data;

  const voiceClone = await prisma.voiceClone.findUnique({
    where: { id: voiceCloneId },
    select: {
      id: true,
      provider: true,
      externalVoiceId: true,
      sampleUrl: true,
      userId: true,
    },
  });

  if (!voiceClone) {
    return errorResponse('Voice clone not found', 404);
  }

  let newStatus: string;

  switch (action) {
    case 'verify':
      newStatus = 'ADMIN_VERIFIED';
      break;
    case 'block':
      newStatus = 'ADMIN_BLOCKED';
      // Clean up from provider
      if (!voiceClone.provider || voiceClone.provider === 'elevenlabs') {
        await deleteClonedVoice(voiceClone.externalVoiceId).catch(() => {});
      }
      if (voiceClone.sampleUrl) {
        await deleteFile(voiceClone.sampleUrl).catch(() => {});
      }
      break;
    case 'protect':
      newStatus = 'PROTECTED';
      break;
    case 'unblock':
      newStatus = 'AWAITING_CHALLENGE';
      break;
    default:
      return errorResponse('Invalid action', 400);
  }

  await prisma.$transaction([
    prisma.voiceClone.update({
      where: { id: voiceCloneId },
      data: { verificationStatus: newStatus as never },
    }),
    prisma.moderationAction.create({
      data: {
        userId: voiceClone.userId,
        moderatorId: adminId,
        action: `voice_${action}`,
        reason: `Admin ${action} on voice clone`,
        metadata: { targetType: 'voice_clone', targetId: voiceCloneId },
      },
    }),
  ]);

  return NextResponse.json({ success: true, verificationStatus: newStatus });
}
