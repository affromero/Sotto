import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AdminShell } from './AdminShell';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user) {
    redirect('/auth/login');
  }

  const role = (session.user as Record<string, unknown>)?.role as string;

  if (role !== 'ADMIN') {
    redirect('/dashboard');
  }

  return (
    <AdminShell
      user={{
        name: session.user.name ?? null,
        email: session.user.email ?? null,
        image: session.user.image ?? null,
      }}
    >
      {children}
    </AdminShell>
  );
}
