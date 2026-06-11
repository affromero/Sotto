import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import { generateAvatarBodySchema } from '@/types/launch-video';

interface Params {
  params: Promise<{ projectId: string }>;
}

/** GET /api/admin/demo/[projectId]/avatar — Get avatar clip status/URL */
export async function GET(_request: NextRequest, { params }: Params) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const { projectId } = await params;

  const project = await prisma.demoProject.findUnique({
    where: { id: projectId },
    select: { avatarClipUrl: true },
  });
  if (!project) return errorResponse('Project not found', 404);

  return NextResponse.json({ avatarClipUrl: project.avatarClipUrl });
}

/** POST /api/admin/demo/[projectId]/avatar — Generate an avatar clip (placeholder — actual generation TBD) */
export async function POST(request: NextRequest, { params }: Params) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const { projectId } = await params;
  const body = await request.json();
  const parsed = generateAvatarBodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0].message, 400);
  }

  const project = await prisma.demoProject.findUnique({ where: { id: projectId } });
  if (!project) return errorResponse('Project not found', 404);

  // Avatar generation is a pre-production step — the actual Fal HeyGen call
  // will be integrated when the avatar pipeline is ready. For now, store the
  // request params and allow manual URL setting via PATCH.
  const { narrationText, avatarId, avatarProvider } = parsed.data;

  return NextResponse.json({
    status: 'pending',
    message: 'Avatar generation queued. Use PATCH /api/admin/demo/[projectId] to set avatarClipUrl manually after generation.',
    params: { narrationText, avatarId, avatarProvider },
  }, { status: 202 });
}
