import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ACTIVE_PROFILE_COOKIE } from '@/lib/local-user';
import { isSelfHosted } from '@/lib/self-hosted';
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

  // Household landing: with more than one profile and no active pick yet, send
  // the visitor to the "Who's learning?" gate (Netflix-style). A single-profile
  // install never has this and lands straight in the app.
  if (isSelfHosted()) {
    const cookieStore = await cookies();
    if (!cookieStore.get(ACTIVE_PROFILE_COOKIE)?.value) {
      const profileCount = await prisma.user.count();
      if (profileCount > 1) redirect('/profiles');
    }
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
