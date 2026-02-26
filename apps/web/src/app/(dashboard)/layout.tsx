import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { DashboardShell } from './DashboardShell';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user) {
    redirect('/auth/login');
  }

  const userId = session.user.id as string;
  const podcastCount = await prisma.podcast.count({
    where: { userId, deletedAt: null },
  });

  return (
    <DashboardShell
      user={{
        name: session.user.name ?? null,
        email: session.user.email ?? null,
        image: session.user.image ?? null,
        role: ((session.user as Record<string, unknown>).role as string) ?? 'USER',
      }}
      hasPodcasts={podcastCount > 0}
    >
      {children}
    </DashboardShell>
  );
}
