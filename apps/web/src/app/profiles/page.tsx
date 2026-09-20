import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { isAccessError } from 'thesidedoor-core/access';
import { getHouseholdProfiles } from '@/lib/profiles';
import { ProfilePicker } from '@/components/profiles/ProfilePicker';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "Who's learning?",
  robots: { index: false, follow: false },
};

export default async function ProfilesPage() {
  let profiles;
  try {
    profiles = await getHouseholdProfiles(
      new Request('http://localhost/profiles', { headers: await headers() })
    );
  } catch (error) {
    if (isAccessError(error) && error.code === 'unauthorized') redirect('/access');
    throw error;
  }
  return (
    <ProfilePicker
      profiles={profiles}
      activeId={profiles.find((profile) => profile.isActive)?.id ?? null}
    />
  );
}
