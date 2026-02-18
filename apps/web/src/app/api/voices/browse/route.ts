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

  const { search, sort, pricing, page, limit } = parsed.data;
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

  // Pricing filter
  if (pricing === 'free') {
    where.OR = where.OR
      ? { AND: [{ OR: where.OR }, { OR: [{ priceInCents: null }, { priceInCents: 0 }] }] }
      : { OR: [{ priceInCents: null }, { priceInCents: 0 }] };
    if (where.OR && !Array.isArray(where.OR)) {
      // Flatten: move the combined condition
      const combined = where.OR;
      delete where.OR;
      Object.assign(where, combined);
    }
  } else if (pricing === 'paid') {
    where.priceInCents = { gt: 0 };
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
        priceInCents: true,
        createdAt: true,
        externalVoiceId: true,
        user: {
          select: {
            id: true,
            name: true,
            handle: true,
            image: true,
            stripeOnboarded: true,
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

  // Enrich with user's request status and purchase status if authenticated
  let requestStatusMap: Record<string, string> = {};
  let purchasedSet = new Set<string>();
  if (currentUserId) {
    const voiceIds = voices.map((v) => v.id);

    const [userRequests, userPurchases, userAllowlist] = await Promise.all([
      prisma.voiceRequest.findMany({
        where: { requesterId: currentUserId, voiceCloneId: { in: voiceIds } },
        select: { voiceCloneId: true, status: true },
      }),
      prisma.voicePurchase.findMany({
        where: {
          buyerId: currentUserId,
          voiceCloneId: { in: voiceIds },
          status: { in: ['authorized', 'captured'] },
        },
        select: { voiceCloneId: true },
      }),
      prisma.voiceAllowlist.findMany({
        where: { allowedUserId: currentUserId, voiceCloneId: { in: voiceIds } },
        select: { voiceCloneId: true },
      }),
    ]);

    requestStatusMap = Object.fromEntries(
      userRequests.map((r) => [r.voiceCloneId, r.status])
    );
    purchasedSet = new Set([
      ...userPurchases.map((p) => p.voiceCloneId),
      ...userAllowlist.map((a) => a.voiceCloneId),
    ]);
  }

  const enrichedVoices = voices.map((v) => {
    const isOwner = currentUserId === v.user.id;
    const hasAccess =
      isOwner ||
      requestStatusMap[v.id] === 'APPROVED' ||
      purchasedSet.has(v.id);

    return {
      id: v.id,
      name: v.name,
      description: v.description,
      sourceType: v.sourceType,
      priceInCents: v.priceInCents,
      createdAt: v.createdAt.toISOString(),
      externalVoiceId: v.externalVoiceId,
      owner: {
        id: v.user.id,
        name: v.user.name,
        handle: v.user.handle,
        image: v.user.image,
      },
      ownerStripeOnboarded: v.user.stripeOnboarded,
      approvedCount: v._count.voiceRequests,
      requestStatus: requestStatusMap[v.id] ?? null,
      hasAccess,
    };
  });

  return NextResponse.json({
    voices: enrichedVoices,
    total,
    page,
    hasMore: skip + limit < total,
  });
}
