import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AdminShell } from './AdminShell';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user) {
    redirect('/auth/login');
  }

  const role = (session.user as Record<string, unknown>)?.role as string;

  if (role !== 'ADMIN') {
    redirect('/dashboard');
  }

  return <AdminShell>{children}</AdminShell>;
}
