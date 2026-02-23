import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { addJob, JobType, scriptGenerationQueue } from '@/lib/queue';
import { checkRateLimit } from '@/lib/redis';
import { checkGenerationGate } from '@/lib/generation-gate';
import { regenerateWithFeedbackSchema } from '@/lib/validations';
import { formatUserFeedback } from '@/lib/feedback-formatter';

type RouteParams = { params: Promise<{ podcastId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;

  // Rate limit: 20/hour, 100/day
  const hourly = await checkRateLimit(`generate:hour:${userId}`, 20, 3600);
  if (!hourly.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded: max 20 generations per hour.' },
      { status: 429 }
    );
  }
  const daily = await checkRateLimit(`generate:day:${userId}`, 100, 86400);
  if (!daily.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded: max 100 generations per day.' },
      { status: 429 }
    );
  }

  // Generation gate: BYOK or free tier
  const gate = await checkGenerationGate(userId);
  if (!gate.allowed) {
    const msg =
      gate.reason === 'free_tier_exhausted'
        ? 'Free generations used. Add your own API keys to continue.'
        : 'No voice provider available. Add a TTS key in Settings for unlimited generation.';
    return NextResponse.json({ error: msg, code: gate.reason }, { status: 403 });
  }

  // Parse optional feedback body
  let feedbackBody: { feedback?: string; turnComments?: Record<number, string>; highlights?: Array<{ turnIndex: number; text: string; note: string }> } | undefined;
  try {
    const text = await request.text();
    if (text.trim()) {
      const parsed = regenerateWithFeedbackSchema.parse(JSON.parse(text));
      feedbackBody = parsed ?? undefined;
    }
  } catch {
    return NextResponse.json({ error: 'Invalid feedback body' }, { status: 400 });
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { userId: true, status: true },
  });

  if (!podcast) {
    return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
  }
  if (podcast.userId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (podcast.status !== 'SCRIPT_READY') {
    return NextResponse.json(
      { error: 'Script can only be regenerated when status is SCRIPT_READY' },
      { status: 400 }
    );
  }

  const discovery = await prisma.discovery.findUnique({
    where: { podcastId },
  });
  if (!discovery) {
    return NextResponse.json({ error: 'Discovery not found' }, { status: 404 });
  }

  // Read current script + references BEFORE deleting (needed for feedback-based revision)
  const hasFeedback = feedbackBody && (feedbackBody.feedback || feedbackBody.turnComments || feedbackBody.highlights);
  let previousTurns: Array<{ speaker: string; text: string; direction?: string }> | undefined;
  let previousReferences: Array<{ number: number; title: string; authors?: string; year?: number; url?: string; type: string; publisher?: string; doi?: string }> | undefined;
  let formattedFeedback: string | undefined;

  if (hasFeedback) {
    const existingScript = await prisma.script.findUnique({
      where: { podcastId },
      select: { turns: true },
    });
    const existingRefs = await prisma.reference.findMany({
      where: { podcastId },
      orderBy: { number: 'asc' },
    });

    if (existingScript?.turns) {
      previousTurns = existingScript.turns as Array<{ speaker: string; text: string; direction?: string }>;
    }
    if (existingRefs.length > 0) {
      previousReferences = existingRefs.map((r) => ({
        number: r.number,
        title: r.title,
        authors: (r.authors as string[])?.join(', '),
        year: r.year ?? undefined,
        url: r.url ?? undefined,
        type: r.type,
        publisher: r.publisher ?? undefined,
        doi: r.doi ?? undefined,
      }));
    }

    formattedFeedback = formatUserFeedback({
      feedback: feedbackBody!.feedback,
      turnComments: feedbackBody!.turnComments,
      highlights: feedbackBody!.highlights,
      turns: previousTurns,
    });
  }

  // Delete existing script, segments, and references
  await prisma.$transaction([
    prisma.segment.deleteMany({ where: { podcastId } }),
    prisma.reference.deleteMany({ where: { podcastId } }),
    prisma.script.deleteMany({ where: { podcastId } }),
  ]);

  // Set status back to SCRIPTING and queue script generation
  await prisma.podcast.update({
    where: { id: podcastId },
    data: { status: 'SCRIPTING' },
  });

  await addJob(scriptGenerationQueue, JobType.GENERATE_SCRIPT, {
    podcastId,
    userId,
    discoveryId: discovery.id,
    sourceContent: discovery.sourceContent ?? undefined,
    ...(formattedFeedback && previousTurns ? {
      userFeedback: formattedFeedback,
      previousTurns,
      previousReferences,
    } : {}),
  });

  return NextResponse.json({ success: true });
}
