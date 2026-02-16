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
    prisma.voiceClone.count({ where: { requestable: true } }),
  ]);

  // Enrich with request status if authenticated
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

  const serializedVoices = voices.map((v) => ({
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

  const topBarUser = session?.user
    ? { name: session.user.name, image: session.user.image, id: session.user.id }
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
