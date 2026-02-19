import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import type { Metadata } from 'next';
import { TopBar } from '@/components/layout/TopBar';
import { VoicesClient } from './VoicesClient';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Voice Marketplace — Sotto',
  description: 'Browse and request access to community voice clones on Sotto.',
};

export default async function VoicesPage() {
  const session = await auth();
  const currentUserId = session?.user?.id ?? null;

  const [voices, total] = await Promise.all([
    prisma.voiceClone.findMany({
      where: { requestable: true },
      orderBy: { createdAt: 'desc' },
      take: 24,
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
    prisma.voiceClone.count({ where: { requestable: true } }),
  ]);

  // Enrich with request status and access if authenticated
  let requestStatusMap: Record<string, string> = {};
  let accessSet = new Set<string>();
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
    accessSet = new Set([
      ...userPurchases.map((p) => p.voiceCloneId),
      ...userAllowlist.map((a) => a.voiceCloneId),
    ]);
  }

  const serializedVoices = voices.map((v) => {
    const isOwner = currentUserId === v.user.id;
    const hasAccess =
      isOwner ||
      requestStatusMap[v.id] === 'APPROVED' ||
      accessSet.has(v.id);

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

  const topBarUser = session?.user
    ? { name: session.user.name, email: session.user.email, image: session.user.image, id: session.user.id }
    : null;

  return (
    <>
      <TopBar user={topBarUser} />
      <main className={styles.main}>
        <div className={styles.container}>
          <VoicesClient
            initialVoices={serializedVoices}
            totalVoices={total}
            currentUserId={currentUserId}
            isAuthenticated={!!currentUserId}
          />
        </div>
      </main>
    </>
  );
}
