import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AcceptInvite } from './AcceptInvite';

interface InvitePageProps {
  params: Promise<{ token: string }>;
}

export const metadata = { title: 'Team Invite' };

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    redirect(`/auth/login?callbackUrl=/team/invite/${token}`);
  }

  return (
    <main style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', padding: 'var(--spacing-xl)' }}>
      <AcceptInvite token={token} />
    </main>
  );
}
