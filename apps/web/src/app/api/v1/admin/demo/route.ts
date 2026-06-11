import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireAdmin } from '@/lib/auth-guards';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import { createDemoProjectSchema } from '@/lib/validations';
import { launchVideoScriptSchema } from '@/types/launch-video';
import { addJob, JobType, demoScriptQueue } from '@/lib/queue';
import { getProviderForModel } from '@/lib/providers/ai-registry';

/** GET /api/admin/demo — List all DemoProjects */
export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const projects = await prisma.demoProject.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { scenes: true } } },
  });

  return NextResponse.json(projects);
}

/** POST /api/admin/demo — Create a DemoProject. If scriptJson is provided, create scenes directly (SCRIPT_READY). Otherwise queue AI generation. */
export async function POST(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const body = await request.json();
  const parsed = createDemoProjectSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0].message, 400);
  }

  const { title, description, features, durationTarget, aiModel, defaultTtsProvider, defaultTtsModel, defaultTtsVoiceId, showcaseProviders, scriptJson } = parsed.data;

  // If scriptJson provided, validate it and create scenes directly
  if (scriptJson) {
    const scriptParsed = launchVideoScriptSchema.safeParse(scriptJson);
    if (!scriptParsed.success) {
      return errorResponse(`Invalid script JSON: ${scriptParsed.error.issues[0].message}`, 400);
    }

    const script = scriptParsed.data;

    const project = await prisma.demoProject.create({
      data: {
        userId: adminId,
        title: script.project.title,
        description: script.project.description ?? description,
        features,
        aiModel,
        status: 'SCRIPT_READY',
        defaultTtsProvider: script.defaults.ttsProvider ?? defaultTtsProvider,
        defaultTtsModel: script.defaults.ttsModel ?? defaultTtsModel,
        defaultTtsVoiceId: script.defaults.ttsVoiceId ?? defaultTtsVoiceId,
        showcaseProviders: showcaseProviders ?? [],
        backgroundMusicUrl: script.defaults.backgroundMusicUrl,
        backgroundMusicVolume: script.defaults.backgroundMusicVolume,
        scenes: {
          create: script.scenes.map((scene, i) => ({
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
          })),
        },
      },
    });

    return NextResponse.json({ id: project.id, status: project.status }, { status: 201 });
  }

  if (!aiModel) {
    return errorResponse('aiModel is required when scriptJson is not provided', 400);
  }
  if (!getProviderForModel(aiModel)) {
    return errorResponse(`Unknown AI model: "${aiModel}"`, 400);
  }

  // AI-generated script flow
  const project = await prisma.demoProject.create({
    data: {
      userId: adminId,
      title,
      description,
      features,
      aiModel,
      defaultTtsProvider,
      defaultTtsModel,
      defaultTtsVoiceId,
      showcaseProviders: showcaseProviders ?? [],
    },
  });

  await addJob(
    demoScriptQueue,
    JobType.GENERATE_DEMO_SCRIPT,
    { projectId: project.id, durationTarget },
    { jobId: `demo-script-${project.id}-${Date.now()}` },
  );

  return NextResponse.json({ id: project.id, status: project.status }, { status: 201 });
}
