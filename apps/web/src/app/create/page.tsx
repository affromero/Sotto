import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { canResolveAi } from '@/lib/providers/ai';
import { canResolveTts } from '@/lib/providers/tts';
import { CreatePageClient } from './CreatePageClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Create a Podcast' };

export default async function CreatePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/auth/login');
  }

  const userId = session.user.id;

  const [hasAi, hasTts] = await Promise.all([canResolveAi(userId), canResolveTts(userId)]);

  if (!hasAi || !hasTts) {
    redirect('/onboarding?step=keys');
  }

  return <CreatePageClient />;
}
