import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type { Metadata } from 'next';
import { ProfileClient } from './ProfileClient';
import styles from './page.module.css';

interface ProfilePageProps {
  params: Promise<{ userId: string }>;
}

export async function generateMetadata({ params }: ProfilePageProps): Promise<Metadata> {
  const { userId } = await params;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, bio: true },
  });

  if (!user) return { title: 'User Not Found' };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://sotto.fm';

  return {
    title: user.name || 'Profile',
    description: user.bio || `${user.name || 'User'}'s podcasts on Sotto`,
    alternates: {
      types: {
        'application/rss+xml': `${appUrl}/api/users/${userId}/rss`,
      },
    },
  };
}

export default async function ProfilePage({ params }: ProfilePageProps) {
  const { userId: profileUserId } = await params;
  const session = await auth();
  const currentUserId = session?.user?.id;

  const user = await prisma.user.findUnique({
    where: { id: profileUserId },
    select: {
      id: true,
      name: true,
      handle: true,
      image: true,
      bio: true,
      role: true,
      createdAt: true,
      podcasts: {
        where: {
          status: 'READY',
          visibility: 'PUBLIC',
          deletedAt: null,
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
          source: true,
          isHumanContent: true,
          forkedFromId: true,
          user: {
            select: { id: true, name: true, image: true, handle: true },
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
            where: { status: 'READY', visibility: 'PUBLIC', deletedAt: null },
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

  if (user.handle) {
    redirect(`/@${user.handle}`);
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

  // Check early access: user's email has a waitlist entry with signedUpAt set
  let isEarlyAccess = false;
  const userEmail = await prisma.user.findUnique({
    where: { id: user.id },
    select: { email: true },
  });
  if (userEmail?.email) {
    const waitlistEntry = await prisma.waitlist.findUnique({
      where: { email: userEmail.email },
      select: { signedUpAt: true },
    });
    isEarlyAccess = !!waitlistEntry?.signedUpAt;
  }

  const profileData = {
    id: user.id,
    name: user.name,
    handle: user.handle,
    image: user.image,
    bio: user.bio,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };

  const podcastList = user.podcasts.map((p) => ({
    ...p,
    createdAt: p.createdAt.toISOString(),
    tags: p.tags.map((pt) => pt.tag),
    ownerIsPro: false,
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
          isAuthenticated={!!currentUserId}
          isEarlyAccess={isEarlyAccess}
          currentUserId={currentUserId}
        />
      </div>
    </main>
  );
}
