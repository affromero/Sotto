import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { CollectionDetail } from '@/components/collections/CollectionDetail';
import styles from './page.module.css';

interface CollectionPageProps {
  params: Promise<{ collectionId: string }>;
}

export async function generateMetadata({ params }: CollectionPageProps): Promise<Metadata> {
  const { collectionId } = await params;
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { name: true, description: true, user: { select: { name: true } } },
  });

  if (!collection) return { title: 'Collection Not Found' };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://sotto.fm';
  const title = `${collection.name} — Sotto Collection`;
  const description = collection.description || `A curated podcast collection by ${collection.user.name || 'Anonymous'}`;
  const canonicalUrl = `${appUrl}/collections/${collectionId}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      url: canonicalUrl,
      siteName: 'Sotto',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      site: '@SottoFM',
    },
    alternates: {
      canonical: canonicalUrl,
    },
  };
}

export default async function CollectionPage({ params }: CollectionPageProps) {
  const { collectionId } = await params;
  const session = await auth();
  const userId = session?.user?.id;

  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    include: {
      user: {
        select: { id: true, name: true, handle: true, image: true },
      },
      items: {
        where: { podcast: { deletedAt: null } },
        orderBy: { order: 'asc' },
        include: {
          podcast: {
            select: {
              id: true,
              title: true,
              topic: true,
              status: true,
              visibility: true,
              audioUrl: true,
              duration: true,
              playCount: true,
              likeCount: true,
              forkCount: true,
              createdAt: true,
              source: true,
              isHumanContent: true,
              forkedFromId: true,
              user: {
                select: { id: true, name: true, handle: true, image: true },
              },
              tags: {
                include: {
                  tag: { select: { id: true, name: true, slug: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!collection) {
    notFound();
  }

  // Private collections only visible to owner
  if (!collection.isPublic && collection.userId !== userId) {
    notFound();
  }

  // Check if the current user follows this collection
  let isFollowing = false;
  if (userId) {
    const follow = await prisma.collectionFollow.findUnique({
      where: {
        userId_collectionId: { userId, collectionId: collection.id },
      },
    });
    isFollowing = !!follow;
  }

  const isOwner = userId === collection.userId;

  // Filter non-ready/private podcasts for non-owners
  const items = collection.items
    .filter((item) => {
      if (isOwner) return true;
      return item.podcast.status === 'READY' && item.podcast.visibility === 'PUBLIC';
    })
    .map((item) => ({
      ...item.podcast,
      createdAt: item.podcast.createdAt.toISOString(),
      tags: item.podcast.tags.map((pt) => pt.tag),
      ownerIsPro: false,
      addedAt: item.addedAt.toISOString(),
      order: item.order,
    }));

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <nav className={styles.breadcrumb}>
          <a href="/feed" className={styles.backLink}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            Feed
          </a>
        </nav>

        <CollectionDetail
          id={collection.id}
          name={collection.name}
          description={collection.description}
          isPublic={collection.isPublic}
          podcastCount={collection.podcastCount}
          followerCount={collection.followerCount}
          createdAt={collection.createdAt.toISOString()}
          user={collection.user}
          items={items}
          isFollowing={isFollowing}
          isOwner={isOwner}
          isAuthenticated={!!userId}
        />
      </div>
    </main>
  );
}
