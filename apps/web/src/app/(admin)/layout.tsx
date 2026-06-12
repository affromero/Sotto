import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Newsreader, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import { auth } from '@/lib/auth';
import { AdminShell } from './AdminShell';

const newsreader = Newsreader({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  weight: ['400', '500'],
  variable: '--font-newsreader',
  display: 'swap',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-ibm-plex-mono',
  display: 'swap',
});

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-ibm-plex-sans',
  display: 'swap',
});

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

  return (
    <div
      className={`${newsreader.variable} ${ibmPlexMono.variable} ${ibmPlexSans.variable}`}
      style={{ height: '100%' }}
    >
      <AdminShell>{children}</AdminShell>
    </div>
  );
}
