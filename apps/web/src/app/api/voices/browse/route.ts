import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { voiceBrowseQuerySchema } from '@/lib/validations';

export async function GET(request: NextRequest) {
  const session = await auth();
  const currentUserId = session?.user?.id ?? null;

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = voiceBrowseQuerySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { search, sort, page, limit } = parsed.data;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = { requestable: true };

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { user: { name: { contains: search, mode: 'insensitive' } } },
      { user: { handle: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const orderBy =
    sort === 'most_requested'
      ? { voiceRequests: { _count: 'desc' as const } }
      : { createdAt: 'desc' as const };

  const [voices, total] = await Promise.all([
    prisma.voiceClone.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        description: true,
        sourceType: true,
        createdAt: true,
        elevenLabsVoiceId: true,
        user: {
          select: {
            id: true,
            name: true,
            handle: true,
            image: true,
          },
        },
        _count: {
          select: {
            voiceRequests: { where: { status: 'APPROVED' } },
          },
        },
      },
    }),
    prisma.voiceClone.count({ where }),
  ]);

  // Enrich with user's request status if authenticated
  let requestStatusMap: Record<string, string> = {};
  if (currentUserId) {
    const voiceIds = voices.map((v) => v.id);
    const userRequests = await prisma.voiceRequest.findMany({
      where: {
        requesterId: currentUserId,
        voiceCloneId: { in: voiceIds },
      },
      select: {
        voiceCloneId: true,
        status: true,
      },
    });
    requestStatusMap = Object.fromEntries(
      userRequests.map((r) => [r.voiceCloneId, r.status])
    );
  }

  const enrichedVoices = voices.map((v) => ({
    id: v.id,
    name: v.name,
    description: v.description,
    sourceType: v.sourceType,
    createdAt: v.createdAt.toISOString(),
    elevenLabsVoiceId: v.elevenLabsVoiceId,
    owner: v.user,
    approvedCount: v._count.voiceRequests,
    requestStatus: requestStatusMap[v.id] ?? null,
  }));

  return NextResponse.json({
    voices: enrichedVoices,
    total,
    page,
    hasMore: skip + limit < total,
  });
}
