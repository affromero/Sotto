import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { checkGenerationGate } from '@/lib/generation-gate';
import { CreatePageClient } from './CreatePageClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Create a Podcast' };

export default async function CreatePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/auth/login');
  }

  const gate = await checkGenerationGate(session.user.id);

  if (!gate.allowed && gate.reason === 'free_tier_exhausted') {
    redirect('/onboarding?step=keys');
  }

  if (!gate.allowed && gate.reason === 'no_provider') {
    redirect('/onboarding?step=keys');
  }

  const freeTier = gate.isByokUser
    ? null
    : {
        used: gate.freeGenerationsUsed,
        limit: gate.freeGenerationsLimit,
        remaining: gate.freeGenerationsLimit - gate.freeGenerationsUsed,
      };

  return <CreatePageClient freeTier={freeTier} isByokUser={gate.isByokUser} />;
}
