import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

interface CandidateScore {
  userId: string;
  tagScore: number;
  embeddingScore: number;
  collaborativeScore: number;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const currentUserId = session.user.id;

  // Pre-fetch followed user IDs to exclude
  const followedUsers = await prisma.follow.findMany({
    where: { followerId: currentUserId },
    select: { followingId: true },
  });
  const excludeIds = new Set([currentUserId, ...followedUsers.map((f) => f.followingId)]);

  const scores = new Map<string, CandidateScore>();

  function getOrCreate(userId: string): CandidateScore {
    let entry = scores.get(userId);
    if (!entry) {
      entry = { userId, tagScore: 0, embeddingScore: 0, collaborativeScore: 0 };
      scores.set(userId, entry);
    }
    return entry;
  }

  // Signal 1: Tag overlap (weight 0.40)
  try {
    const tagCandidates = await prisma.$queryRawUnsafe<
      Array<{ userId: string; overlapScore: number }>
    >(
      `SELECT ui2."userId", SUM(LEAST(ui1.weight, ui2.weight)) as "overlapScore"
       FROM "UserInterest" ui1
       JOIN "UserInterest" ui2 ON ui1."tagId" = ui2."tagId" AND ui1."userId" != ui2."userId"
       WHERE ui1."userId" = $1
       GROUP BY ui2."userId"
       ORDER BY "overlapScore" DESC
       LIMIT 50`,
      currentUserId
    );

    if (tagCandidates.length > 0) {
      const maxTag = Math.max(...tagCandidates.map((c) => Number(c.overlapScore)));
      const minTag = Math.min(...tagCandidates.map((c) => Number(c.overlapScore)));
      const range = maxTag - minTag || 1;

      for (const candidate of tagCandidates) {
        if (excludeIds.has(candidate.userId)) continue;
        const entry = getOrCreate(candidate.userId);
        entry.tagScore = (Number(candidate.overlapScore) - minTag) / range;
      }
    }
  } catch (err) {
    logger.warn('Suggested follows: tag overlap query failed', { error: err });
  }

  // Signal 2: Embedding similarity (weight 0.35)
  try {
    const embeddingCandidates = await prisma.$queryRawUnsafe<
      Array<{ userId: string; similarity: number }>
    >(
      `SELECT uf2."userId", 1 - (uf1.embedding <=> uf2.embedding) as similarity
       FROM "UserFeature" uf1
       JOIN "UserFeature" uf2 ON uf1."userId" != uf2."userId"
       WHERE uf1."userId" = $1
         AND uf1.embedding IS NOT NULL
         AND uf2.embedding IS NOT NULL
       ORDER BY uf1.embedding <=> uf2.embedding
       LIMIT 50`,
      currentUserId
    );

    for (const candidate of embeddingCandidates) {
      if (excludeIds.has(candidate.userId)) continue;
      const entry = getOrCreate(candidate.userId);
      entry.embeddingScore = Math.max(0, Number(candidate.similarity));
    }
  } catch (err) {
    logger.warn('Suggested follows: embedding similarity query failed', { error: err });
  }

  // Signal 3: Collaborative listening (weight 0.25)
  try {
    const collabCandidates = await prisma.$queryRawUnsafe<
      Array<{ userId: string; sharedCount: number }>
    >(
      `SELECT ps2."userId", COUNT(DISTINCT ps2."podcastId")::int as "sharedCount"
       FROM "PlaybackSession" ps1
       JOIN "PlaybackSession" ps2
         ON ps1."podcastId" = ps2."podcastId"
         AND ps1."userId" != ps2."userId"
       WHERE ps1."userId" = $1
         AND ps1."completionPercent" >= 50
         AND ps2."completionPercent" >= 50
         AND ps1."startedAt" > NOW() - INTERVAL '90 days'
         AND ps2."startedAt" > NOW() - INTERVAL '90 days'
         AND ps2."userId" IS NOT NULL
       GROUP BY ps2."userId"
       ORDER BY "sharedCount" DESC
       LIMIT 50`,
      currentUserId
    );

    if (collabCandidates.length > 0) {
      const maxCollab = Math.max(...collabCandidates.map((c) => Number(c.sharedCount)));
      const minCollab = Math.min(...collabCandidates.map((c) => Number(c.sharedCount)));
      const range = maxCollab - minCollab || 1;

      for (const candidate of collabCandidates) {
        if (excludeIds.has(candidate.userId)) continue;
        const entry = getOrCreate(candidate.userId);
        entry.collaborativeScore = (Number(candidate.sharedCount) - minCollab) / range;
      }
    }
  } catch (err) {
    logger.warn('Suggested follows: collaborative query failed', { error: err });
  }

  // Combine signals
  const candidates = Array.from(scores.values())
    .map((s) => ({
      userId: s.userId,
      score: s.tagScore * 0.4 + s.embeddingScore * 0.35 + s.collaborativeScore * 0.25,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  if (candidates.length === 0) {
    return NextResponse.json({ users: [] });
  }

  // Fetch user details
  const userIds = candidates.map((c) => c.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      name: true,
      handle: true,
      image: true,
      bio: true,
      _count: { select: { followers: true, podcasts: { where: { deletedAt: null } } } },
      interests: {
        select: { tag: { select: { name: true } } },
        take: 10,
      },
    },
  });

  // Current user's interest tags for computing shared interests
  const currentUserInterests = await prisma.userInterest.findMany({
    where: { userId: currentUserId },
    select: { tag: { select: { name: true } } },
  });
  const currentInterestNames = new Set(currentUserInterests.map((i) => i.tag.name));

  // Preserve score ordering
  const userMap = new Map(users.map((u) => [u.id, u]));
  const results = candidates
    .map((c) => {
      const user = userMap.get(c.userId);
      if (!user) return null;
      const userInterestNames = user.interests.map((i: { tag: { name: string } }) => i.tag.name);
      const sharedInterests = userInterestNames.filter((n: string) => currentInterestNames.has(n));
      return {
        id: user.id,
        name: user.name,
        handle: user.handle,
        image: user.image,
        bio: user.bio,
        followerCount: user._count.followers,
        podcastCount: user._count.podcasts,
        sharedInterests,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ users: results });
}
