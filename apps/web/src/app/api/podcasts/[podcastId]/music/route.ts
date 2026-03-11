import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { checkMusicGenerationGate, tryIncrementMusicGeneration } from '@/lib/music-gate';
import { generateMusicSchema } from '@/lib/validations';
import { addJob, JobType, musicGenerationQueue } from '@/lib/queue';
import { deleteFile, extractR2Key } from '@/lib/r2';
import { logger } from '@/lib/logger';
import { getAllMusicProviderMeta, type MusicProviderId } from '@/lib/providers/music-registry';

type RouteParams = { params: Promise<{ podcastId: string }> };

/**
 * POST — Trigger background music generation for a READY podcast.
 * Allows multiple generations per podcast. Blocks if one is already in progress.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(request);

  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const adminId = await requireAdmin();
  const isAdmin = adminId !== null;

  // Feature gate
  const gate = !isAdmin ? await checkMusicGenerationGate(authResult.userId) : null;
  if (gate && !gate.allowed) {
    const message = gate.reason === 'daily_limit_reached'
      ? 'Daily music generation limit reached. Try again later.'
      : 'No music provider available. Add a Suno or ElevenLabs API key in Settings.';
    return errorResponse(message, gate.reason === 'daily_limit_reached' ? 429 : 403, {
      code: gate.reason,
      dailyUsed: gate.dailyUsed,
      dailyLimit: gate.dailyLimit,
      resetInSeconds: gate.resetInSeconds,
    });
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { id: true, userId: true, status: true },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }

  if (podcast.userId !== authResult.userId && !isAdmin) {
    return errorResponse('Forbidden', 403);
  }

  if (podcast.status !== 'READY') {
    return errorResponse('Podcast must be in READY status to generate music', 400);
  }

  // Parse optional body for model preference
  let model: string | undefined;
  try {
    const body = await request.json();
    const parsed = generateMusicSchema.safeParse(body);
    if (parsed.success && parsed.data) {
      model = parsed.data.model;
    }
  } catch {
    // No body — use defaults
  }

  // Block if a generation is already in progress for this podcast
  const inProgress = await prisma.musicGeneration.findFirst({
    where: { podcastId, status: { in: ['PENDING', 'GENERATING'] } },
    select: { id: true, status: true },
  });

  if (inProgress) {
    return NextResponse.json({
      musicGenerationId: inProgress.id,
      status: inProgress.status,
    });
  }

  // Increment daily counter (non-admin, non-BYOK users)
  if (gate && !gate.isByokUser) {
    const incremented = await tryIncrementMusicGeneration(authResult.userId, gate.dailyLimit);
    if (!incremented) {
      return errorResponse('Daily music generation limit reached. Try again later.', 429, {
        code: 'daily_limit_reached',
      });
    }
  }

  // Create MusicGeneration record
  const musicGeneration = await prisma.musicGeneration.create({
    data: {
      podcastId,
      status: 'PENDING',
      model: model ?? null,
    },
  });

  // Queue the job
  await addJob(musicGenerationQueue, JobType.GENERATE_MUSIC, {
    podcastId,
    musicGenerationId: musicGeneration.id,
    userId: authResult.userId,
  });

  logger.info('Music generation queued', { podcastId, musicGenerationId: musicGeneration.id });

  return NextResponse.json({
    musicGenerationId: musicGeneration.id,
    status: 'PENDING',
  });
}

/**
 * GET — List all music generations for a podcast + available models with pricing.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(request);

  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { id: true, userId: true },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }

  const adminId = await requireAdmin();
  if (podcast.userId !== authResult.userId && !adminId) {
    return errorResponse('Forbidden', 403);
  }

  const generations = await prisma.musicGeneration.findMany({
    where: { podcastId },
    select: {
      id: true,
      status: true,
      musicUrl: true,
      duration: true,
      fileSize: true,
      provider: true,
      model: true,
      failureReason: true,
      selected: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  // Resolve available models for this user (BYOK keys + platform keys)
  const availableModels = await getAvailableModelsForUser(authResult.userId);

  return NextResponse.json({ generations, availableModels });
}

async function getAvailableModelsForUser(userId: string): Promise<Array<{ id: string; label: string; provider: string; costPerTrack: number }>> {
  // Check which music providers the user has access to (BYOK or platform)
  const byokKeys = await prisma.userTtsKey.findMany({
    where: { userId, provider: { in: ['suno', 'elevenlabs'] }, isValid: true },
    select: { provider: true },
  });
  const byokProviders = new Set(byokKeys.map((k) => k.provider));

  const availableProviders = new Set<MusicProviderId>();
  if (byokProviders.has('suno') || process.env.SUNO_API_KEY) availableProviders.add('suno');
  if (byokProviders.has('elevenlabs') || process.env.ELEVENLABS_API_KEY) availableProviders.add('elevenlabs');

  const allMeta = getAllMusicProviderMeta();
  const models: Array<{ id: string; label: string; provider: string; costPerTrack: number }> = [];
  for (const meta of allMeta) {
    if (!availableProviders.has(meta.id)) continue;
    for (const model of meta.models) {
      models.push({ id: model.id, label: model.displayName, provider: meta.displayName, costPerTrack: model.costPerTrack });
    }
  }
  return models;
}

/**
 * DELETE — Remove a specific music generation or all generations for the podcast.
 * Pass ?generationId=<id> to delete a specific one, or omit to delete all.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(request);

  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { id: true, userId: true },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }

  const adminId = await requireAdmin();
  if (podcast.userId !== authResult.userId && !adminId) {
    return errorResponse('Forbidden', 403);
  }

  const generationId = request.nextUrl.searchParams.get('generationId');

  if (generationId) {
    // Delete a specific generation
    const gen = await prisma.musicGeneration.findFirst({
      where: { id: generationId, podcastId },
      select: { id: true, musicUrl: true, selected: true },
    });

    if (!gen) {
      return errorResponse('Music generation not found', 404);
    }

    // Delete R2 file
    if (gen.musicUrl) {
      const key = extractR2Key(gen.musicUrl);
      if (key) {
        await deleteFile(key).catch((err: unknown) => {
          logger.warn('Failed to delete music file from R2', { key, error: err instanceof Error ? err.message : String(err) });
        });
      }
    }

    // If deleting the selected generation, clear Podcast.musicUrl
    await prisma.$transaction([
      prisma.musicGeneration.delete({ where: { id: gen.id } }),
      ...(gen.selected ? [prisma.podcast.update({ where: { id: podcastId }, data: { musicUrl: null } })] : []),
    ]);

    logger.info('Music generation deleted', { podcastId, generationId });
    return NextResponse.json({ success: true });
  }

  // Delete all generations for this podcast
  const allGens = await prisma.musicGeneration.findMany({
    where: { podcastId },
    select: { id: true, musicUrl: true },
  });

  // Delete R2 files
  await Promise.allSettled(
    allGens
      .filter((g) => g.musicUrl)
      .map((g) => {
        const key = extractR2Key(g.musicUrl!);
        return key ? deleteFile(key) : Promise.resolve();
      }),
  );

  await prisma.$transaction([
    prisma.musicGeneration.deleteMany({ where: { podcastId } }),
    prisma.podcast.update({ where: { id: podcastId }, data: { musicUrl: null } }),
  ]);

  logger.info('All music generations deleted', { podcastId });
  return NextResponse.json({ success: true });
}
