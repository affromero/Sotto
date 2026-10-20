import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { DashboardShell } from '../(dashboard)/DashboardShell';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';
import { PlayProfileBoundary } from '@/components/play/client/profile';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function PlayLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/access');
  return (
    <DashboardShell user={session.user} showAgentUsageStatus={false}>
      <PlayProfileBoundary key={session.user.id} profileId={session.user.id}>
        {children}
      </PlayProfileBoundary>
      <InstallPrompt />
    </DashboardShell>
  );
}
