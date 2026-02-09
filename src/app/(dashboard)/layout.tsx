import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { DashboardShell } from './DashboardShell';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user) {
    redirect('/auth/login');
  }

  return (
    <DashboardShell
      user={{
        name: session.user.name ?? null,
        email: session.user.email ?? null,
        image: session.user.image ?? null,
        role: ((session.user as Record<string, unknown>).role as string) ?? 'USER',
      }}
    >
      {children}
    </DashboardShell>
  );
}
