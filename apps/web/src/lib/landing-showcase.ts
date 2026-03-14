import { prisma } from './prisma';

export interface LandingShowcaseConfig {
  podcastId: string;
  scriptTurnStart: number;
  scriptTurnCount: number;
  audioClipStart: number;
  audioClipEnd: number | null;
  videoClipStart: number;
  videoClipEnd: number | null;
  twitterHandle: string;
  twitterName: string;
  telegramTopic: string | null;
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
      videoClipStart: row.videoClipStart,
      videoClipEnd: row.videoClipEnd,
      twitterHandle: row.twitterHandle,
      twitterName: row.twitterName,
      telegramTopic: row.telegramTopic,
    };
  } catch {
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
      ...(data.videoClipStart !== undefined && { videoClipStart: data.videoClipStart }),
      ...(data.videoClipEnd !== undefined && { videoClipEnd: data.videoClipEnd }),
      ...(data.twitterHandle !== undefined && { twitterHandle: data.twitterHandle }),
      ...(data.twitterName !== undefined && { twitterName: data.twitterName }),
      ...(data.telegramTopic !== undefined && { telegramTopic: data.telegramTopic }),
      updatedBy: adminId,
    },
    create: {
      id: 'singleton',
      podcastId: data.podcastId,
      scriptTurnStart: data.scriptTurnStart ?? 0,
      scriptTurnCount: data.scriptTurnCount ?? 2,
      audioClipStart: data.audioClipStart ?? 0,
      audioClipEnd: data.audioClipEnd ?? null,
      videoClipStart: data.videoClipStart ?? 0,
      videoClipEnd: data.videoClipEnd ?? null,
      twitterHandle: data.twitterHandle ?? 'andres',
      twitterName: data.twitterName ?? 'Andres',
      telegramTopic: data.telegramTopic ?? null,
      updatedBy: adminId,
    },
  });
}
