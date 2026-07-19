import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { accessPasswordConfigured, verifyGateToken, GATE_COOKIE } from '@/lib/access/gate';
import { AccessGate } from '@/components/profiles/AccessGate';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sotto',
  robots: { index: false, follow: false },
};

export default async function GatePage() {
  if (!accessPasswordConfigured()) {
    redirect('/');
  }

  const cookieStore = await cookies();
  if (await verifyGateToken(cookieStore.get(GATE_COOKIE)?.value)) {
    redirect('/profiles');
  }

  return <AccessGate />;
}
