import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ONBOARDING_TAG_SLUGS } from '@/lib/tag-icons';
import { OnboardingForm } from './OnboardingForm';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Welcome to Sotto' };

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/auth/login');
  }

  // Check if already onboarded
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { hasCompletedOnboarding: true },
  });

  if (user?.hasCompletedOnboarding) {
    redirect('/create');
  }

  // Fetch the onboarding tags
  const tags = await prisma.tag.findMany({
    where: { slug: { in: ONBOARDING_TAG_SLUGS } },
    select: { id: true, name: true, slug: true },
    orderBy: { name: 'asc' },
  });

  // Sort by the order defined in ONBOARDING_TAG_SLUGS
  const slugOrder = new Map(ONBOARDING_TAG_SLUGS.map((s, i) => [s, i]));
  tags.sort((a, b) => (slugOrder.get(a.slug) ?? 99) - (slugOrder.get(b.slug) ?? 99));

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1 className={styles.title}>What are you curious about?</h1>
          <p className={styles.subtitle}>
            Pick topics that interest you. This helps us personalize your experience.
          </p>
        </header>

        <OnboardingForm tags={tags} />
      </div>
    </main>
  );
}
