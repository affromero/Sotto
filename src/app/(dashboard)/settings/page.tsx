import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ONBOARDING_TAG_SLUGS } from '@/lib/tag-icons';
import { SettingsForm } from './SettingsForm';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return null;
  }

  const [user, accounts, voiceClones, userInterests, allTags] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        email: true,
        image: true,
        bio: true,
        twitterHandle: true,
        twitterEnabled: true,
        preferredHostVoiceId: true,
        preferredExpertVoiceId: true,
      },
    }),
    prisma.account.findMany({
      where: { userId },
      select: {
        provider: true,
      },
    }),
    prisma.voiceClone.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        elevenLabsVoiceId: true,
      },
    }),
    prisma.userInterest.findMany({
      where: { userId },
      select: { tagId: true },
    }),
    prisma.tag.findMany({
      where: { slug: { in: ONBOARDING_TAG_SLUGS } },
      select: { id: true, name: true, slug: true },
    }),
  ]);

  if (!user) return null;

  const connectedProviders = accounts.map((a) => a.provider);
  const selectedInterestTagIds = userInterests.map((i) => i.tagId);

  // Sort tags by the order defined in ONBOARDING_TAG_SLUGS
  const slugOrder = new Map(ONBOARDING_TAG_SLUGS.map((s, i) => [s, i]));
  allTags.sort((a, b) => (slugOrder.get(a.slug) ?? 99) - (slugOrder.get(b.slug) ?? 99));

  return (
    <main className={styles.main}>
      <h1 className={styles.pageTitle}>Settings</h1>

      <SettingsForm
        initialName={user.name ?? ''}
        initialBio={user.bio ?? ''}
        email={user.email}
        image={user.image}
        connectedProviders={connectedProviders}
        twitterHandle={user.twitterHandle}
        twitterEnabled={user.twitterEnabled}
        preferredHostVoiceId={user.preferredHostVoiceId}
        preferredExpertVoiceId={user.preferredExpertVoiceId}
        voiceClones={voiceClones}
        interestTags={allTags}
        selectedInterestTagIds={selectedInterestTagIds}
      />
    </main>
  );
}
