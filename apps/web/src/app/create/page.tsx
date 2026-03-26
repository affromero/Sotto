import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { checkGenerationGate } from '@/lib/generation-gate';
import { getTierFeatures } from '@/lib/tier-features';
import { LIMITS } from '@/lib/stripe';
import { CreatePageClient } from './CreatePageClient';
import type { DraftData } from './CreatePageClient';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Create a Podcast',
  robots: { index: false, follow: false },
};

async function loadDraft(draftId: string, userId: string): Promise<DraftData | undefined> {
  const podcast = await prisma.podcast.findUnique({
    where: { id: draftId },
    include: {
      discovery: {
        include: {
          messages: { orderBy: { createdAt: 'asc' } },
        },
      },
    },
  });

  if (
    podcast &&
    podcast.userId === userId &&
    podcast.status === 'DRAFT'
  ) {
    const dd = podcast.draftData as Record<string, unknown> | null;
    return {
      id: podcast.id,
      tabMode: (dd?.tabMode as 'create' | 'import') ?? 'create',
      messages: podcast.discovery?.messages.map((msg) => ({
        id: msg.id,
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
        chips: Array.isArray(msg.chips) ? (msg.chips as string[]) : [],
        createdAt: msg.createdAt.toISOString(),
      })) ?? [],
      metadata: podcast.discovery
        ? {
            topic: podcast.discovery.topic ?? undefined,
            depth: podcast.discovery.depth ?? undefined,
            audienceLevel: podcast.discovery.audienceLevel ?? undefined,
            audience: podcast.discovery.audience ?? undefined,
            focusAreas: podcast.discovery.focusAreas,
            tone: podcast.discovery.tone ?? undefined,
            durationTarget: podcast.discovery.durationTarget ?? undefined,
          }
        : null,
      draftData: dd ?? null,
    };
  }
  return undefined;
}

export default async function CreatePage({
  searchParams,
}: {
  searchParams: Promise<{ draftId?: string; topic?: string; as?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/auth/login');
  }

  const params = await searchParams;

  // Draft fetch and generation gate check run in parallel
  const [draftData, gate] = await Promise.all([
    params.draftId ? loadDraft(params.draftId, session.user.id) : Promise.resolve(undefined),
    checkGenerationGate(session.user.id),
  ]);

  if (!gate.allowed && gate.reason === 'no_provider') {
    redirect('/billing');
  }

  const userRole = ((session?.user as Record<string, unknown>)?.role as string) ?? 'USER';
  const plan = gate.isProUser ? 'PRO' as const : 'FREE' as const;
  const tierFeatures = getTierFeatures(plan, gate.isByokUser, userRole);
  const maxDurationMinutes = isFinite(tierFeatures.maxDurationMinutes)
    ? tierFeatures.maxDurationMinutes
    : LIMITS.maxDurationMinutes;

  // dailyLimit === 0 is the sentinel for admin-granted unlimited override
  const isUnlimitedOverride = gate.dailyLimit === 0;

  const freeTier =
    gate.isByokUser || gate.isProUser || isUnlimitedOverride
      ? null
      : {
          dailyUsed: gate.dailyUsed,
          dailyLimit: gate.dailyLimit,
          dailyRemaining: Math.max(0, gate.dailyLimit - gate.dailyUsed),
          ttsQuotas: gate.ttsQuotas,
        };

  const isAdmin = userRole === 'ADMIN';

  return (
    <CreatePageClient
      freeTier={freeTier}
      isByokUser={gate.isByokUser}
      isProUser={gate.isProUser}
      maxDurationMinutes={maxDurationMinutes}
      maxSpeakers={tierFeatures.maxSpeakers}
      isAdmin={isAdmin}
      draftData={draftData}
    />
  );
}
