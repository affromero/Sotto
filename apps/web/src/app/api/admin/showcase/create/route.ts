import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import { createDemoSchema } from '@/lib/validations';
import { addJob, JobType, scriptGenerationQueue } from '@/lib/queue';
import { generatePodcastSlug } from '@/lib/slugify';

/** POST /api/admin/showcase/create — Create a demo podcast for the showcase builder */
export async function POST(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const body = await request.json();
  const parsed = createDemoSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0].message, 400);
  }

  const { topic, title, featureFocus, durationTarget, speakers, aiModel } = parsed.data;

  const podcastTitle = title || `Demo: ${topic.slice(0, 150)}`;
  const slug = await generatePodcastSlug(podcastTitle, adminId, prisma);

  const podcast = await prisma.podcast.create({
    data: {
      userId: adminId,
      title: podcastTitle,
      topic,
      slug,
      status: 'SCRIPTING',
      source: 'ADMIN',
      verificationMode: 'showcase',
      aiModel: aiModel ?? undefined,
      visibility: 'PRIVATE',
    },
  });

  const discovery = await prisma.discovery.create({
    data: {
      podcastId: podcast.id,
      topic,
      depth: 'quick_overview',
      audienceLevel: 'intermediate',
      audience: 'general',
      focusAreas: featureFocus ?? [],
      tone: 'casual',
      durationTarget,
      speakers: speakers ?? undefined,
    },
  });

  await addJob(
    scriptGenerationQueue,
    JobType.GENERATE_SCRIPT,
    {
      podcastId: podcast.id,
      userId: adminId,
      discoveryId: discovery.id,
      useAdminCredits: true,
    },
    { jobId: `script-${podcast.id}-${Date.now()}` },
  );

  return NextResponse.json({ podcastId: podcast.id, status: podcast.status });
}
