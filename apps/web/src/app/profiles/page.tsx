import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { hasCompletedInitialOnboarding } from '@/lib/local-user';
import { getHouseholdProfiles } from '@/lib/profiles';
import { isSelfHosted } from '@/lib/self-hosted';
import { ProfilePicker } from '@/components/profiles/ProfilePicker';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "Who's learning?",
  robots: { index: false, follow: false },
};

export default async function ProfilesPage() {
  if (isSelfHosted() && !(await hasCompletedInitialOnboarding())) {
    redirect('/welcome');
  }

  const session = await auth();
  const profiles = await getHouseholdProfiles();
  return <ProfilePicker profiles={profiles} activeId={session?.user.id ?? null} />;
}
