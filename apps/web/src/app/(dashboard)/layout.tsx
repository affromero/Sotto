import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getLearnerOnboarding } from '@/lib/sidedoor/access/core/onboarding';
import { isSelfHosted } from '@/lib/self-hosted';
import { DashboardShell } from './DashboardShell';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user) {
    redirect('/access');
  }

  if (isSelfHosted() && !(await getLearnerOnboarding(session.user.id)).completed)
    redirect('/welcome');

  const userId = session.user.id as string;
  const [episodeCount, usagePrefs] = await Promise.all([
    prisma.episode.count({
      where: { userId, deletedAt: null },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { showAgentUsageStatus: true },
    }),
  ]);

  return (
    <DashboardShell
      user={{
        id: session.user.id,
        name: session.user.name ?? null,
        email: session.user.email ?? null,
        image: session.user.image ?? null,
        role: session.user.role,
      }}
      hasEpisodes={episodeCount > 0}
      showAgentUsageStatus={usagePrefs?.showAgentUsageStatus ?? true}
    >
      {children}
      <InstallPrompt />
    </DashboardShell>
  );
}
