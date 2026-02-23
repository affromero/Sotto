import { prisma } from './prisma';

export interface RecentPipelineError {
  id: string;
  podcastId: string;
  podcastTitle: string;
  createdAt: Date;
  stage: string;
  type: string;
  message: string;
  metadata: Record<string, unknown> | null;
}

export async function getRecentPipelineErrors(
  limit: number = 20,
): Promise<RecentPipelineError[]> {
  const events = await prisma.pipelineEvent.findMany({
    where: { type: { in: ['error', 'retry'] } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      podcastId: true,
      createdAt: true,
      stage: true,
      type: true,
      message: true,
      metadata: true,
      podcast: {
        select: { title: true },
      },
    },
  });

  return events.map((e) => ({
    id: e.id,
    podcastId: e.podcastId,
    podcastTitle: e.podcast.title,
    createdAt: e.createdAt,
    stage: e.stage,
    type: e.type,
    message: e.message,
    metadata: e.metadata as Record<string, unknown> | null,
  }));
}

export interface RecentDiscoveryChatError {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  userMessage: string;
  errorKind: string;
  errorDetail: string | null;
  discoveryId: string | null;
  createdAt: Date;
}

export async function getRecentDiscoveryChatErrors(
  limit: number = 20,
): Promise<RecentDiscoveryChatError[]> {
  const errors = await prisma.discoveryChatError.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      userId: true,
      userMessage: true,
      errorKind: true,
      errorDetail: true,
      discoveryId: true,
      createdAt: true,
      user: { select: { name: true, email: true } },
    },
  });

  return errors.map((e) => ({
    id: e.id,
    userId: e.userId,
    userName: e.user.name,
    userEmail: e.user.email,
    userMessage: e.userMessage,
    errorKind: e.errorKind,
    errorDetail: e.errorDetail,
    discoveryId: e.discoveryId,
    createdAt: e.createdAt,
  }));
}
