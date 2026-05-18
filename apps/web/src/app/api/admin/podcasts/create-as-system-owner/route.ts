import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prisma } from '@/lib/prisma';
import { generatePodcastSlug } from '@/lib/slugify';
import { errorResponse } from '@/lib/api-response';
import { contentExtractionQueue, addJob, JobType } from '@/lib/queue';
import type { ExtractContentPayload } from '@/lib/queue';
import { selectFreeTierProviders } from '@/lib/free-tier-provider-selector';
import {
  getSystemUserErrorMessage,
  getSystemUserErrorStatus,
  requireSystemUser,
} from '@/lib/system-user';
import type { SystemUserRecord } from '@/lib/system-user';

export async function POST(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  let systemUser: SystemUserRecord;
  try {
    systemUser = await requireSystemUser(prisma);
  } catch (error) {
    return errorResponse(getSystemUserErrorMessage(error), getSystemUserErrorStatus(error));
  }

  const body = await request.json();
  const { title, topic, metadata, ttsProvider, ttsModel, aiModel } = body;

  if (!title || !topic) {
    return errorResponse('title and topic are required', 400);
  }

  const slug = await generatePodcastSlug(title, systemUser.id, prisma);
  const hasMetadata = metadata && typeof metadata === 'object';
  const selectedProviders = hasMetadata && !aiModel
    ? await selectFreeTierProviders(systemUser.id)
    : null;

  const podcast = await prisma.podcast.create({
    data: {
      userId: systemUser.id,
      title,
      topic,
      slug,
      status: hasMetadata ? 'EXTRACTING' : 'PENDING',
      visibility: 'PUBLIC',
      source: 'WEB',
      ...(ttsProvider ? { ttsProvider } : {}),
      ...(ttsModel ? { ttsModel } : {}),
      aiModel: aiModel ?? selectedProviders?.aiModel ?? null,
    },
  });

  // When metadata is provided, create Discovery and queue pipeline
  if (hasMetadata) {
    await prisma.discovery.create({
      data: {
        podcastId: podcast.id,
        userId: systemUser.id,
        topic: metadata.topic || topic,
        depth: metadata.depth,
        audienceLevel: metadata.audienceLevel,
        audience: metadata.audience,
        focusAreas: metadata.focusAreas ?? [],
        tone: metadata.tone,
        durationTarget: metadata.durationTarget,
        speakers: metadata.speakers ?? undefined,
      },
    });

    const payload: ExtractContentPayload = {
      podcastId: podcast.id,
      userId: systemUser.id,
      useAdminCredits: true,
    };
    await addJob(contentExtractionQueue, JobType.EXTRACT_CONTENT, payload, { priority: 1 });
  }

  return NextResponse.json({ id: podcast.id, status: podcast.status }, { status: 201 });
}
