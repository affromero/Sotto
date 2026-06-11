import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import { linkPodcastBodySchema } from '@/types/launch-video';

interface Params {
  params: Promise<{ projectId: string }>;
}

/** GET /api/admin/demo/[projectId]/podcast — Get the linked podcast with script */
export async function GET(_request: NextRequest, { params }: Params) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const { projectId } = await params;

  const project = await prisma.demoProject.findUnique({ where: { id: projectId } });
  if (!project) return errorResponse('Project not found', 404);
  if (!project.podcastId) return NextResponse.json(null);

  const podcast = await prisma.podcast.findUnique({
    where: { id: project.podcastId },
    include: {
      script: true,
    },
  });

  return NextResponse.json(podcast);
}

/** POST /api/admin/demo/[projectId]/podcast — Link an existing podcast or create a new one */
export async function POST(request: NextRequest, { params }: Params) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const { projectId } = await params;
  const body = await request.json();
  const parsed = linkPodcastBodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0].message, 400);
  }

  const project = await prisma.demoProject.findUnique({ where: { id: projectId } });
  if (!project) return errorResponse('Project not found', 404);

  let podcastId: string;

  if ('podcastId' in parsed.data) {
    // Link an existing podcast
    const podcast = await prisma.podcast.findUnique({ where: { id: parsed.data.podcastId } });
    if (!podcast) return errorResponse('Podcast not found', 404);
    podcastId = podcast.id;
  } else {
    // Create a new podcast for this demo project
    const podcast = await prisma.podcast.create({
      data: {
        userId: adminId,
        topic: parsed.data.topic,
        title: parsed.data.title ?? project.title,
        visibility: 'PRIVATE',
      },
    });
    podcastId = podcast.id;
  }

  await prisma.demoProject.update({
    where: { id: projectId },
    data: { podcastId },
  });

  return NextResponse.json({ podcastId }, { status: 201 });
}
