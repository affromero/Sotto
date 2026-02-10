import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getUserTier } from '@/lib/subscription';
import { createVoiceRequestSchema } from '@/lib/validations';

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Verify requester is a paid tier
  const requesterTier = await getUserTier(session.user.id);
  if (requesterTier === 'FREE') {
    return NextResponse.json(
      { error: 'Voice sharing requires a paid subscription' },
      { status: 403 }
    );
  }

  const body = await request.json();
  const parsed = createVoiceRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
  }

  const { voiceCloneId, message } = parsed.data;

  // Verify voice clone exists and is requestable
  const voiceClone = await prisma.voiceClone.findUnique({
    where: { id: voiceCloneId },
    select: {
      id: true,
      requestable: true,
      userId: true,
      name: true,
      user: { select: { id: true, name: true } },
    },
  });

  if (!voiceClone) {
    return NextResponse.json({ error: 'Voice clone not found' }, { status: 404 });
  }

  if (!voiceClone.requestable) {
    return NextResponse.json({ error: 'This voice is not available for sharing' }, { status: 403 });
  }

  if (voiceClone.userId === session.user.id) {
    return NextResponse.json({ error: 'You cannot request your own voice' }, { status: 400 });
  }

  // Verify voice owner is Studio tier
  const ownerTier = await getUserTier(voiceClone.userId);
  if (ownerTier !== 'STUDIO') {
    return NextResponse.json(
      { error: 'Voice sharing is only available from Studio tier creators' },
      { status: 403 }
    );
  }

  // Create the request (unique constraint prevents duplicates)
  try {
    const voiceRequest = await prisma.voiceRequest.create({
      data: {
        requesterId: session.user.id,
        voiceOwnerId: voiceClone.userId,
        voiceCloneId,
        message: message || null,
      },
    });

    // Send notification to voice owner
    await prisma.notification.create({
      data: {
        userId: voiceClone.userId,
        type: 'VOICE_REQUEST_RECEIVED',
        title: 'Voice Request Received',
        message: `Someone requested to use your voice "${voiceClone.name}".`,
        data: { voiceRequestId: voiceRequest.id, voiceCloneId },
      },
    });

    return NextResponse.json(voiceRequest, { status: 201 });
  } catch (err: unknown) {
    // Handle unique constraint violation (duplicate request)
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      return NextResponse.json({ error: 'You have already requested this voice' }, { status: 409 });
    }
    throw err;
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [sent, received] = await Promise.all([
    prisma.voiceRequest.findMany({
      where: { requesterId: session.user.id },
      include: {
        voiceClone: { select: { id: true, name: true } },
        voiceOwner: { select: { id: true, name: true, image: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.voiceRequest.findMany({
      where: { voiceOwnerId: session.user.id },
      include: {
        voiceClone: { select: { id: true, name: true } },
        requester: { select: { id: true, name: true, image: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return NextResponse.json({ sent, received });
}
