import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getLearnerOnboarding } from '@/lib/sidedoor/access/core/onboarding';
import { isSelfHosted } from '@/lib/self-hosted';
import { AdminShell } from './AdminShell';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user) {
    redirect('/access');
  }

  if (isSelfHosted() && !(await getLearnerOnboarding(session.user.id)).completed) {
    redirect('/welcome');
  }

  const role = session.user.role;

  if (role !== 'ADMIN') {
    redirect('/dashboard');
  }

  return (
    <div style={{ height: '100%' }}>
      <AdminShell>{children}</AdminShell>
    </div>
  );
}
