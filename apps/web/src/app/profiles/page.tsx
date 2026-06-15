import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { getHouseholdProfiles } from '@/lib/profiles';
import { ProfilePicker } from '@/components/profiles/ProfilePicker';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "Who's learning?",
  robots: { index: false, follow: false },
};

export default async function ProfilesPage() {
  const session = await auth();
  const profiles = await getHouseholdProfiles();
  return <ProfilePicker profiles={profiles} activeId={session?.user.id ?? null} />;
}
