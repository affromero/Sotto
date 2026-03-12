import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { voiceBrowseQuerySchema } from '@/lib/validations';
import { getPlanFeatureConfig } from '@/lib/plan-feature-config';
import { errorResponse } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  const [session, voiceConfig] = await Promise.all([auth(), getPlanFeatureConfig()]);
  const currentUserId = session?.user?.id ?? null;

  if (!voiceConfig.voiceMarketplaceEnabled) {
    return errorResponse('Voice marketplace is currently unavailable.', 503);
  }

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = voiceBrowseQuerySchema.safeParse(params);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { search, sort, pricing, page, limit } = parsed.data;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {
    requestable: true,
    verificationStatus: { in: ['VERIFIED', 'ADMIN_VERIFIED'] },
  };

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
        verificationStatus: true,
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
      isVerified: v.verificationStatus === 'VERIFIED' || v.verificationStatus === 'ADMIN_VERIFIED',
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
