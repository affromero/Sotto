import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { forkBodySchema } from '@/lib/validations';
import { getUserTier } from '@/lib/subscription';
import { canGenerate } from '@/lib/stripe';
import { consumeCredit } from '@/lib/credits';
import { contentExtractionQueue, notificationQueue, addJob, JobType } from '@/lib/queue';
import type { ExtractContentPayload, SendNotificationPayload } from '@/lib/queue';

type RouteParams = { params: Promise<{ podcastId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;

  const body = await request.json().catch(() => ({}));
  const parsed = forkBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { topic, remixNote, focusAreas, depth, tone } = parsed.data;

  const sourcePodcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    include: {
      tags: { select: { tagId: true } },
      discovery: {
        select: {
          durationTarget: true,
          audienceLevel: true,
          audience: true,
          depth: true,
          tone: true,
          focusAreas: true,
        },
      },
      script: { select: { markdown: true } },
      user: { select: { name: true } },
    },
  });

  if (!sourcePodcast) {
    return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
  }

  if (sourcePodcast.visibility !== 'PUBLIC') {
    return NextResponse.json({ error: 'Only public podcasts can be forked' }, { status: 403 });
  }

  if (sourcePodcast.status !== 'READY') {
    return NextResponse.json(
      { error: 'Only podcasts with READY status can be forked' },
      { status: 400 }
    );
  }

  // Credit check
  const tier = await getUserTier(userId);
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
    select: { creditsBalance: true },
  });
  const creditsBalance = subscription?.creditsBalance ?? 0;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  const check = canGenerate(creditsBalance, false, tier, user?.role, 0);
  if (!check.allowed) {
    return NextResponse.json({ error: check.reason }, { status: 402 });
  }

  // Consume credit
  try {
    await consumeCredit(userId, check.cost, 'Fork generation', undefined);
  } catch {
    return NextResponse.json(
      { error: 'Insufficient credits to fork this podcast.' },
      { status: 402 }
    );
  }

  // Create fork podcast + discovery in a transaction
  const forkedPodcast = await prisma.$transaction(async (tx) => {
    const newPodcast = await tx.podcast.create({
      data: {
        userId,
        title: topic ? `${topic}` : `Fork of ${sourcePodcast.title}`,
        topic: topic || sourcePodcast.topic,
        remixNote: remixNote || null,
        status: 'PENDING',
        forkedFromId: podcastId,
        creditCost: check.cost,
      },
    });

    // Create synthetic Discovery so the pipeline works
    await tx.discovery.create({
      data: {
        podcastId: newPodcast.id,
        userId,
        topic: topic || sourcePodcast.topic,
        depth: depth || sourcePodcast.discovery?.depth || 'standard',
        audienceLevel: sourcePodcast.discovery?.audienceLevel || 'intermediate',
        audience: sourcePodcast.discovery?.audience || 'general',
        focusAreas: focusAreas || sourcePodcast.discovery?.focusAreas || [],
        tone: tone || sourcePodcast.discovery?.tone || 'casual',
        durationTarget: sourcePodcast.discovery?.durationTarget || 10,
        sourceContent: sourcePodcast.script?.markdown || null,
      },
    });

    // Copy tags to the forked podcast
    if (sourcePodcast.tags.length > 0) {
      await tx.podcastTag.createMany({
        data: sourcePodcast.tags.map((pt) => ({
          podcastId: newPodcast.id,
          tagId: pt.tagId,
        })),
      });
    }

    // Increment source podcast fork count
    await tx.podcast.update({
      where: { id: podcastId },
      data: { forkCount: { increment: 1 } },
    });

    return newPodcast;
  });

  // Update credit cost reference on the podcast (already set in create)
  // Set status to EXTRACTING and enqueue generation
  await prisma.podcast.update({
    where: { id: forkedPodcast.id },
    data: { status: 'EXTRACTING' },
  });

  const extractPayload: ExtractContentPayload = {
    podcastId: forkedPodcast.id,
    userId,
    sourceText: sourcePodcast.script?.markdown || undefined,
  };
  await addJob(contentExtractionQueue, JobType.EXTRACT_CONTENT, extractPayload);

  // Notify source podcast owner about the fork
  if (sourcePodcast.userId !== userId) {
    const forkerName = session.user.name || 'Someone';
    const notifPayload: SendNotificationPayload = {
      userId: sourcePodcast.userId,
      type: 'PODCAST_FORKED',
      title: 'Your podcast was forked!',
      message: `${forkerName} forked "${sourcePodcast.title}"`,
      data: {
        podcastId,
        forkId: forkedPodcast.id,
        forkerName,
      },
    };
    await addJob(notificationQueue, JobType.SEND_NOTIFICATION, notifPayload);
  }

  return NextResponse.json({ id: forkedPodcast.id }, { status: 201 });
}
