import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { cloneVoice, deleteClonedVoice } from '@/lib/elevenlabs';
import { cloneVoiceSchema } from '@/lib/validations';
import { getUserTier } from '@/lib/subscription';
import { TIER_LIMITS } from '@/lib/stripe';

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tier = await getUserTier(session.user.id);
  const limits = TIER_LIMITS[tier];

  if (limits.maxVoiceClones === 0) {
    return NextResponse.json(
      { error: 'Voice cloning requires a paid subscription' },
      { status: 403 }
    );
  }

  const existingCount = await prisma.voiceClone.count({
    where: { userId: session.user.id },
  });

  if (existingCount >= limits.maxVoiceClones) {
    return NextResponse.json(
      { error: `Maximum of ${limits.maxVoiceClones} voice clones allowed for your tier` },
      { status: 403 }
    );
  }

  const formData = await request.formData();
  const name = formData.get('name') as string;
  const sourceType = formData.get('sourceType') as string;
  const audioFile = formData.get('audio') as File | null;

  const parsed = cloneVoiceSchema.safeParse({ name, sourceType });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (!audioFile) {
    return NextResponse.json({ error: 'Audio file is required' }, { status: 400 });
  }

  const arrayBuffer = await audioFile.arrayBuffer();
  const audioBuffer = Buffer.from(arrayBuffer);

  const { voiceId } = await cloneVoice(parsed.data.name, [audioBuffer]);

  const voiceClone = await prisma.voiceClone.create({
    data: {
      userId: session.user.id,
      name: parsed.data.name,
      elevenLabsVoiceId: voiceId,
      sourceType: parsed.data.sourceType,
    },
  });

  return NextResponse.json(voiceClone, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { voiceCloneId, requestable } = body;

  if (!voiceCloneId || typeof voiceCloneId !== 'string' || typeof requestable !== 'boolean') {
    return NextResponse.json(
      { error: 'voiceCloneId and requestable are required' },
      { status: 400 }
    );
  }

  const voiceClone = await prisma.voiceClone.findUnique({
    where: { id: voiceCloneId },
  });

  if (!voiceClone) {
    return NextResponse.json({ error: 'Voice clone not found' }, { status: 404 });
  }

  if (voiceClone.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Only Studio tier users can make voices requestable
  if (requestable) {
    const tier = await getUserTier(session.user.id);
    if (tier !== 'STUDIO') {
      return NextResponse.json(
        { error: 'Only Studio tier users can share voice clones' },
        { status: 403 }
      );
    }
  }

  const updated = await prisma.voiceClone.update({
    where: { id: voiceCloneId },
    data: { requestable },
  });

  return NextResponse.json(updated);
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { voiceCloneId } = body;

  if (!voiceCloneId || typeof voiceCloneId !== 'string') {
    return NextResponse.json({ error: 'voiceCloneId is required' }, { status: 400 });
  }

  const voiceClone = await prisma.voiceClone.findUnique({
    where: { id: voiceCloneId },
  });

  if (!voiceClone) {
    return NextResponse.json({ error: 'Voice clone not found' }, { status: 404 });
  }

  if (voiceClone.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await deleteClonedVoice(voiceClone.elevenLabsVoiceId);

  // Clean up voice requests for this clone
  await prisma.voiceRequest.deleteMany({
    where: { voiceCloneId },
  });

  await prisma.voiceClone.delete({
    where: { id: voiceCloneId },
  });

  return NextResponse.json({ success: true });
}
