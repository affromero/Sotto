import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireAdmin } from '@/lib/auth-guards';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import { importScriptBodySchema } from '@/types/launch-video';

interface Params {
  params: Promise<{ projectId: string }>;
}

/** POST /api/admin/demo/[projectId]/import-script — Replace all scenes from a launch video JSON script */
export async function POST(request: NextRequest, { params }: Params) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const { projectId } = await params;
  const body = await request.json();
  const parsed = importScriptBodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0].message, 400);
  }

  const { script } = parsed.data;

  // Verify project exists
  const project = await prisma.demoProject.findUnique({ where: { id: projectId } });
  if (!project) return errorResponse('Project not found', 404);

  // Delete existing scenes and create new ones from script
  await prisma.$transaction([
    prisma.demoScene.deleteMany({ where: { projectId } }),
    ...script.scenes.map((scene, i) =>
      prisma.demoScene.create({
        data: {
          projectId,
          order: i,
          title: scene.title,
          narration: scene.narration,
          actions: scene.actions as unknown as Prisma.InputJsonValue,
          ttsProvider: scene.ttsProvider,
          ttsModel: scene.ttsModel,
          ttsVoiceId: scene.ttsVoiceId,
          transitionType: scene.transition?.type ?? null,
          sfxConfig: scene.sfx as unknown as Prisma.InputJsonValue ?? Prisma.JsonNull,
          providerBanner: scene.providerBanner as unknown as Prisma.InputJsonValue ?? Prisma.JsonNull,
          avatarConfig: scene.avatar as unknown as Prisma.InputJsonValue ?? Prisma.JsonNull,
          overlays: scene.overlays as unknown as Prisma.InputJsonValue ?? Prisma.JsonNull,
          subtitles: scene.subtitles as unknown as Prisma.InputJsonValue ?? Prisma.JsonNull,
        },
      }),
    ),
    prisma.demoProject.update({
      where: { id: projectId },
      data: {
        title: script.project.title,
        description: script.project.description,
        status: 'SCRIPT_READY',
        defaultTtsProvider: script.defaults.ttsProvider,
        defaultTtsModel: script.defaults.ttsModel,
        defaultTtsVoiceId: script.defaults.ttsVoiceId,
        backgroundMusicUrl: script.defaults.backgroundMusicUrl,
        backgroundMusicVolume: script.defaults.backgroundMusicVolume,
      },
    }),
  ]);

  const updated = await prisma.demoProject.findUnique({
    where: { id: projectId },
    include: { scenes: { orderBy: { order: 'asc' } } },
  });

  return NextResponse.json(updated);
}
