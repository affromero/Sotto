import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth-guards';
import { prisma } from '@/lib/prisma';
import { generatePodcastSlug } from '@/lib/slugify';
import { contentExtractionQueue, addJob, JobType } from '@/lib/queue';
import type { ExtractContentPayload } from '@/lib/queue';
import { setLandingShowcaseConfig } from '@/lib/landing-showcase';
import { errorResponse } from '@/lib/api-response';

const SHOWCASE_TOPIC = `CRISPR gene editing — how it works, real-world applications, and what it means for the future of medicine. Cover the molecular mechanism (Cas9 as molecular scissors), current clinical trials, ethical considerations, and recent breakthroughs in treating genetic diseases.`;

const SHOWCASE_METADATA = {
  topic: SHOWCASE_TOPIC,
  depth: 'standard',
  audienceLevel: 'beginner',
  audience: 'general',
  focusAreas: ['molecular mechanism', 'clinical applications', 'ethics', 'recent breakthroughs'],
  tone: 'casual',
  durationTarget: 10,
};

export async function POST() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const sottoUser = await prisma.user.findUnique({
    where: { handle: 'sotto' },
    select: { id: true },
  });

  if (!sottoUser) {
    return errorResponse('@sotto system account not found', 404);
  }

  const title = 'CRISPR Gene Editing Explained';
  const slug = await generatePodcastSlug(title, sottoUser.id, prisma);

  const podcast = await prisma.podcast.create({
    data: {
      userId: sottoUser.id,
      title,
      topic: SHOWCASE_TOPIC,
      slug,
      status: 'EXTRACTING',
      visibility: 'PUBLIC',
      source: 'ADMIN',
      verificationMode: 'showcase',
    },
  });

  await prisma.discovery.create({
    data: {
      podcastId: podcast.id,
      userId: sottoUser.id,
      ...SHOWCASE_METADATA,
      messages: {
        create: [
          { role: 'user', content: 'I want to understand how CRISPR gene editing works' },
          {
            role: 'assistant',
            content: "Fascinating topic! To tailor this for you — what's your background in biology?",
            chips: [
              { label: 'Complete beginner', value: 'beginner' },
              { label: 'Some college bio', value: 'intermediate' },
              { label: 'Biology professional', value: 'expert' },
            ],
          },
          { role: 'user', content: 'Complete beginner, but I love science docs' },
          {
            role: 'assistant',
            content: "Perfect. I'll use everyday analogies and build up from the basics. Let me research CRISPR and write your podcast!",
          },
        ],
      },
    },
  });

  const payload: ExtractContentPayload = {
    podcastId: podcast.id,
    userId: sottoUser.id,
    useAdminCredits: true,
  };
  await addJob(contentExtractionQueue, JobType.EXTRACT_CONTENT, payload, { priority: 1 });

  // Pre-set this podcast as the landing showcase config
  await setLandingShowcaseConfig({ podcastId: podcast.id }, adminId);
  revalidatePath('/');

  return NextResponse.json({
    id: podcast.id,
    status: podcast.status,
    message: 'Showcase podcast created and pipeline started. Config will activate once podcast reaches READY status.',
  }, { status: 201 });
}
