import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function ProfileRedirectPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/auth/login');
  }

  redirect('/settings');
}
