import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getFreeTierStatus } from '@/lib/generation-gate';
import { getTierFeatures } from '@/lib/tier-features';
import { EditPodcastForm } from './EditPodcastForm';
import styles from './page.module.css';

interface EditPodcastPageProps {
  params: Promise<{ podcastId: string }>;
}

export const metadata = { title: 'Edit Podcast' };

export default async function EditPodcastPage({ params }: EditPodcastPageProps) {
  const { podcastId } = await params;
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    redirect('/auth/login');
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: {
      id: true,
      title: true,
      topic: true,
      visibility: true,
      userId: true,
    },
  });

  if (!podcast) {
    notFound();
  }

  if (podcast.userId !== userId) {
    notFound();
  }

  const freeTier = await getFreeTierStatus(userId);
  const plan = freeTier.isProUser ? 'PRO' as const : 'FREE' as const;
  const tierFeatures = getTierFeatures(plan, freeTier.isByokUser);

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <Link href={`/podcast/${podcastId}`} className={styles.backLink}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Back to podcast
        </Link>
        <h1 className={styles.pageTitle}>Edit Podcast</h1>
        <EditPodcastForm
          podcastId={podcast.id}
          initialTitle={podcast.title}
          initialTopic={podcast.topic}
          initialVisibility={podcast.visibility}
          canMakePrivate={tierFeatures.privateAllowed}
        />
      </div>
    </main>
  );
}
