import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import { updateDemoProjectSchema } from '@/lib/validations';

interface Params {
  params: Promise<{ projectId: string }>;
}

/** GET /api/admin/demo/[projectId] — Get project with scenes */
export async function GET(_request: NextRequest, { params }: Params) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const { projectId } = await params;

  const project = await prisma.demoProject.findUnique({
    where: { id: projectId },
    include: { scenes: { orderBy: { order: 'asc' } } },
  });

  if (!project) return errorResponse('Project not found', 404);

  return NextResponse.json(project);
}

/** PATCH /api/admin/demo/[projectId] — Update project metadata */
export async function PATCH(request: NextRequest, { params }: Params) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const { projectId } = await params;
  const body = await request.json();
  const parsed = updateDemoProjectSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0].message, 400);
  }

  const data = parsed.data;

  const project = await prisma.demoProject.update({
    where: { id: projectId },
    data: {
      title: data.title,
      description: data.description,
      features: data.features,
      backgroundMusicUrl: data.backgroundMusicUrl,
      backgroundMusicVolume: data.backgroundMusicVolume,
      avatarClipUrl: data.avatarClipUrl,
      podcastId: data.podcastId,
    },
  });

  return NextResponse.json(project);
}

/** DELETE /api/admin/demo/[projectId] — Delete project (cascades scenes) */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const { projectId } = await params;

  await prisma.demoProject.delete({ where: { id: projectId } });

  return NextResponse.json({ deleted: true });
}
