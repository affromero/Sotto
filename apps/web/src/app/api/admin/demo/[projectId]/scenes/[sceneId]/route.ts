import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireAdmin } from '@/lib/auth-guards';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import { updateDemoSceneSchema } from '@/lib/validations';

interface Params {
  params: Promise<{ projectId: string; sceneId: string }>;
}

/** PATCH /api/admin/demo/[projectId]/scenes/[sceneId] — Update scene */
export async function PATCH(request: NextRequest, { params }: Params) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const { projectId, sceneId } = await params;
  const body = await request.json();
  const parsed = updateDemoSceneSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0].message, 400);
  }

  const data = parsed.data;

  const scene = await prisma.demoScene.update({
    where: { id: sceneId, projectId },
    data: {
      title: data.title,
      narration: data.narration,
      actions: data.actions ? (data.actions as unknown as Prisma.InputJsonValue) : undefined,
      visualPrompt: data.visualPrompt,
      visualType: data.visualType,
      ttsProvider: data.ttsProvider,
      ttsModel: data.ttsModel,
      ttsVoiceId: data.ttsVoiceId,
      transitionType: data.transitionType,
      timingSegments: data.timingSegments !== undefined
        ? (data.timingSegments as unknown as Prisma.InputJsonValue)
        : undefined,
    },
  });

  return NextResponse.json(scene);
}
