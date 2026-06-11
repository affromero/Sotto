import { prisma } from './prisma';
import { logger } from './logger';

export interface LandingShowcaseConfig {
  podcastId: string;
  scriptTurnStart: number;
  scriptTurnCount: number;
  audioClipStart: number;
  audioClipEnd: number | null;
  videoSegmentStart: number;
  videoSegmentCount: number;
  showAvatar: boolean;
  showVideo: boolean;
}

export async function getLandingShowcaseConfig(): Promise<LandingShowcaseConfig | null> {
  try {
    const row = await prisma.landingShowcase.findUnique({
      where: { id: 'singleton' },
    });
    if (!row) return null;

    return {
      podcastId: row.podcastId,
      scriptTurnStart: row.scriptTurnStart,
      scriptTurnCount: row.scriptTurnCount,
      audioClipStart: row.audioClipStart,
      audioClipEnd: row.audioClipEnd,
      videoSegmentStart: row.videoSegmentStart,
      videoSegmentCount: row.videoSegmentCount,
      showAvatar: row.showAvatar,
      showVideo: row.showVideo,
    };
  } catch (err) {
    logger.warn('Failed to read landing showcase config', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function setLandingShowcaseConfig(
  data: Partial<LandingShowcaseConfig> & { podcastId: string },
  adminId: string
): Promise<void> {
  await prisma.landingShowcase.upsert({
    where: { id: 'singleton' },
    update: {
      ...(data.podcastId !== undefined && { podcastId: data.podcastId }),
      ...(data.scriptTurnStart !== undefined && { scriptTurnStart: data.scriptTurnStart }),
      ...(data.scriptTurnCount !== undefined && { scriptTurnCount: data.scriptTurnCount }),
      ...(data.audioClipStart !== undefined && { audioClipStart: data.audioClipStart }),
      ...(data.audioClipEnd !== undefined && { audioClipEnd: data.audioClipEnd }),
      ...(data.videoSegmentStart !== undefined && { videoSegmentStart: data.videoSegmentStart }),
      ...(data.videoSegmentCount !== undefined && { videoSegmentCount: data.videoSegmentCount }),
      ...(data.showAvatar !== undefined && { showAvatar: data.showAvatar }),
      ...(data.showVideo !== undefined && { showVideo: data.showVideo }),
      updatedBy: adminId,
    },
    create: {
      id: 'singleton',
      podcastId: data.podcastId,
      scriptTurnStart: data.scriptTurnStart ?? 0,
      scriptTurnCount: data.scriptTurnCount ?? 2,
      audioClipStart: data.audioClipStart ?? 0,
      audioClipEnd: data.audioClipEnd ?? null,
      videoSegmentStart: data.videoSegmentStart ?? 0,
      videoSegmentCount: data.videoSegmentCount ?? 4,
      showAvatar: data.showAvatar ?? false,
      showVideo: data.showVideo ?? false,
      updatedBy: adminId,
    },
  });
}
