import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type { Metadata } from 'next';
import { ProfileClient } from './ProfileClient';
import styles from './page.module.css';

interface ProfilePageProps {
  params: { userId: string };
}

export async function generateMetadata({ params }: ProfilePageProps): Promise<Metadata> {
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { name: true, bio: true },
  });

  if (!user) return { title: 'User Not Found' };

  return {
    title: user.name || 'Profile',
    description: user.bio || `${user.name || 'User'}'s podcasts on Sotto`,
  };
}

export default async function ProfilePage({ params }: ProfilePageProps) {
  const session = await auth();
  const currentUserId = session?.user?.id;

  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: {
      id: true,
      name: true,
      image: true,
      bio: true,
      createdAt: true,
      podcasts: {
        where: {
          status: 'READY',
          visibility: 'PUBLIC',
        },
        orderBy: { createdAt: 'desc' },
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
          user: {
            select: { id: true, name: true, image: true },
          },
          tags: {
            include: {
              tag: { select: { id: true, name: true, slug: true } },
            },
          },
        },
      },
      _count: {
        select: {
          podcasts: {
            where: { status: 'READY', visibility: 'PUBLIC' },
          },
          followers: true,
          following: true,
        },
      },
    },
  });

  if (!user) {
    notFound();
  }

  // Check if current user follows this user
  let isFollowing = false;
  if (currentUserId && currentUserId !== user.id) {
    const follow = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: currentUserId,
          followingId: user.id,
        },
      },
    });
    isFollowing = !!follow;
  }

  const isOwnProfile = currentUserId === user.id;

  const profileData = {
    id: user.id,
    name: user.name,
    image: user.image,
    bio: user.bio,
    createdAt: user.createdAt.toISOString(),
  };

  const podcastList = user.podcasts.map((p) => ({
    ...p,
    createdAt: p.createdAt.toISOString(),
    tags: p.tags.map((pt) => pt.tag),
  }));

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <ProfileClient
          user={profileData}
          podcasts={podcastList}
          podcastCount={user._count.podcasts}
          followerCount={user._count.followers}
          followingCount={user._count.following}
          isOwnProfile={isOwnProfile}
          initialIsFollowing={isFollowing}
        />
      </div>
    </main>
  );
}
