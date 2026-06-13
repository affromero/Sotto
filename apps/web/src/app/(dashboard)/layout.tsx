import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { DashboardShell } from './DashboardShell';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user) {
    redirect('/auth/login');
  }

  const userId = session.user.id as string;
  const episodeCount = await prisma.episode.count({
    where: { userId, deletedAt: null },
  });

  return (
    <DashboardShell
      user={{
        name: session.user.name ?? null,
        email: session.user.email ?? null,
        image: session.user.image ?? null,
        role: session.user.role,
      }}
      hasEpisodes={episodeCount > 0}
    >
      {children}
      <InstallPrompt />
    </DashboardShell>
  );
}
