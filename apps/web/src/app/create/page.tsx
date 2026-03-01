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

  // Load draft data if draftId is present
  let draftData: DraftData | undefined;
  if (params.draftId) {
    const podcast = await prisma.podcast.findUnique({
      where: { id: params.draftId },
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
      podcast.userId === session.user.id &&
      podcast.status === 'DRAFT'
    ) {
      const dd = podcast.draftData as Record<string, unknown> | null;
      draftData = {
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
    // If invalid draft, ignore it silently — render normal create page
  }

  const gate = await checkGenerationGate(session.user.id);

  if (!gate.allowed && gate.reason === 'no_provider') {
    redirect('/onboarding?step=keys&reason=no_provider');
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
