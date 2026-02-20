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

  if (!gate.allowed && gate.reason === 'no_provider') {
    redirect('/onboarding?step=keys');
  }

  // Daily limit reached — stay on create page with upgrade prompt (don't redirect)
  // The UI shows the banner with countdown and Pro CTA.

  const freeTier =
    gate.isByokUser || gate.isProUser
      ? null
      : {
          used: gate.freeGenerationsUsed,
          limit: gate.freeGenerationsLimit,
          remaining: Math.max(0, gate.freeGenerationsLimit - gate.freeGenerationsUsed),
          dailyUsed: gate.dailyUsed,
          dailyLimit: gate.dailyLimit,
          dailyRemaining: Math.max(0, gate.dailyLimit - gate.dailyUsed),
          ttsQuotas: gate.ttsQuotas,
        };

  return (
    <CreatePageClient
      freeTier={freeTier}
      isByokUser={gate.isByokUser}
      isProUser={gate.isProUser}
    />
  );
}
