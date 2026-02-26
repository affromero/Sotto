import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
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

  const [reportCount, claimCount] = await Promise.all([
    prisma.report.count({ where: { status: 'PENDING' } }),
    prisma.claimReport.count({ where: { status: 'PENDING' } }),
  ]);

  const pendingReportCount = reportCount + claimCount;

  return (
    <AdminShell pendingReportCount={pendingReportCount}>
      {children}
    </AdminShell>
  );
}
