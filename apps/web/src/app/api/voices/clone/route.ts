import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { cloneVoice, deleteClonedVoice } from '@/lib/elevenlabs';
import { cloneVoiceViaFal } from '@/lib/fal-voice-clone';
import { getByokKey } from '@/lib/byok';
import { cloneVoiceSchema } from '@/lib/validations';
import { LIMITS } from '@/lib/stripe';
import { logUsage } from '@/lib/usage-logger';

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const existingCount = await prisma.voiceClone.count({
    where: { userId: session.user.id },
  });

  if (existingCount >= LIMITS.maxVoiceClones) {
    return NextResponse.json(
      { error: `Maximum of ${LIMITS.maxVoiceClones} voice clones allowed` },
      { status: 403 }
    );
  }

  const formData = await request.formData();
  const name = formData.get('name') as string;
  const sourceType = formData.get('sourceType') as string;
  const provider = (formData.get('provider') as string) || 'elevenlabs';
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

  let externalVoiceId: string;

  if (provider === 'fal') {
    const falKey = await getByokKey(session.user.id, 'fal');
    if (!falKey) {
      return NextResponse.json(
        { error: 'Fal API key required for voice cloning. Add it in Settings.' },
        { status: 400 }
      );
    }
    const { embeddingUrl } = await cloneVoiceViaFal(falKey, audioBuffer);
    externalVoiceId = embeddingUrl;
  } else {
    const { voiceId } = await cloneVoice(parsed.data.name, [audioBuffer]);
    externalVoiceId = voiceId;
  }

  logUsage({
    service: provider,
    category: 'voice_clone',
    totalCost: 0,
    userId: session.user.id,
    metadata: { audioSizeBytes: audioBuffer.length },
  });

  const voiceClone = await prisma.voiceClone.create({
    data: {
      userId: session.user.id,
      name: parsed.data.name,
      provider,
      externalVoiceId,
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
  const { voiceCloneId, requestable, description, priceInCents } = body;

  if (!voiceCloneId || typeof voiceCloneId !== 'string') {
    return NextResponse.json({ error: 'voiceCloneId is required' }, { status: 400 });
  }

  const hasRequestable = typeof requestable === 'boolean';
  const hasDescription = typeof description === 'string';
  const hasPrice = priceInCents !== undefined;

  if (!hasRequestable && !hasDescription && !hasPrice) {
    return NextResponse.json(
      { error: 'At least one of requestable, description, or priceInCents is required' },
      { status: 400 }
    );
  }

  if (hasDescription && description.length > 200) {
    return NextResponse.json(
      { error: 'Description must be 200 characters or less' },
      { status: 400 }
    );
  }

  // Validate priceInCents range
  if (hasPrice && priceInCents !== null) {
    if (typeof priceInCents !== 'number' || !Number.isInteger(priceInCents) || priceInCents < 0 || priceInCents > 10000) {
      return NextResponse.json(
        { error: 'Price must be an integer between 0 and 10000 cents ($0-$100)' },
        { status: 400 }
      );
    }
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

  // Setting a price requires Stripe onboarding
  if (hasPrice && priceInCents !== null && priceInCents > 0) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { stripeOnboarded: true },
    });
    if (!user.stripeOnboarded) {
      return NextResponse.json(
        { error: 'Connect your Stripe account before setting a price' },
        { status: 400 }
      );
    }
  }

  const data: Record<string, boolean | string | number | null> = {};
  if (hasRequestable) data.requestable = requestable;
  if (hasDescription) data.description = description;
  if (hasPrice) data.priceInCents = priceInCents;

  const updated = await prisma.voiceClone.update({
    where: { id: voiceCloneId },
    data,
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

  // Only call ElevenLabs delete API for ElevenLabs voices
  if (!voiceClone.provider || voiceClone.provider === 'elevenlabs') {
    await deleteClonedVoice(voiceClone.externalVoiceId);
  }

  // Clean up voice requests for this clone
  await prisma.voiceRequest.deleteMany({
    where: { voiceCloneId },
  });

  await prisma.voiceClone.delete({
    where: { id: voiceCloneId },
  });

  return NextResponse.json({ success: true });
}
