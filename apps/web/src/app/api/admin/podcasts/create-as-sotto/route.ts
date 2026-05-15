import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prisma } from '@/lib/prisma';
import { generatePodcastSlug } from '@/lib/slugify';
import { errorResponse } from '@/lib/api-response';
import { contentExtractionQueue, addJob, JobType } from '@/lib/queue';
import type { ExtractContentPayload } from '@/lib/queue';
import { selectFreeTierProviders } from '@/lib/free-tier-provider-selector';

export async function POST(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  // Find the @sotto system user
  const sottoUser = await prisma.user.findUnique({
    where: { handle: 'sotto' },
    select: { id: true },
  });

  if (!sottoUser) {
    return errorResponse('@sotto system account not found. Run prisma db seed.', 404);
  }

  const body = await request.json();
  const { title, topic, metadata, ttsProvider, ttsModel, aiModel } = body;

  if (!title || !topic) {
    return errorResponse('title and topic are required', 400);
  }

  // Create podcast owned by @sotto
  const slug = await generatePodcastSlug(title, sottoUser.id, prisma);
  const hasMetadata = metadata && typeof metadata === 'object';
  const selectedProviders = hasMetadata && !aiModel
    ? await selectFreeTierProviders(sottoUser.id)
    : null;

  const podcast = await prisma.podcast.create({
    data: {
      userId: sottoUser.id,
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
        userId: sottoUser.id,
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
      userId: sottoUser.id,
      useAdminCredits: true,
    };
    await addJob(contentExtractionQueue, JobType.EXTRACT_CONTENT, payload, { priority: 1 });
  }

  return NextResponse.json({ id: podcast.id, status: podcast.status }, { status: 201 });
}
