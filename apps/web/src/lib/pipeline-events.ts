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
