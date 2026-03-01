import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { cloneVoice, deleteClonedVoice } from '@/lib/elevenlabs';
import { cloneVoiceViaFal } from '@/lib/fal-voice-clone';
import { cloneVoiceViaCartesia } from '@/lib/cartesia-voice-clone';
import { getByokKey, hasByokKey } from '@/lib/byok';
import { cloneVoiceSchema, importVoiceSchema } from '@/lib/validations';
import { LIMITS } from '@/lib/stripe';
import { getTierFeatures } from '@/lib/tier-features';
import { logUsage } from '@/lib/usage-logger';
import { uploadFile } from '@/lib/r2';
import { addJob, voiceVerificationQueue, JobType } from '@/lib/queue';

import { transcodeToMp3, getExtensionFromMime } from '@/lib/audio-transcode';
import { errorResponse } from '@/lib/api-response';

const MAX_AUDIO_SIZE = 5 * 1024 * 1024; // 5MB

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  // Pro gate — voice cloning requires Pro
  const [user, isByok] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { plan: true, role: true },
    }),
    hasByokKey(session.user.id),
  ]);
  const tierFeatures = getTierFeatures(user.plan as 'FREE' | 'PRO', isByok, user.role);
  if (!tierFeatures.voiceCloningEnabled) {
    return errorResponse('Voice cloning requires a Pro subscription.', 403);
  }

  const existingCount = await prisma.voiceClone.count({
    where: { userId: session.user.id },
  });

  if (existingCount >= LIMITS.maxVoiceClones) {
    return errorResponse(`Maximum of ${LIMITS.maxVoiceClones} voice clones allowed`, 403);
  }

  const formData = await request.formData();
  const name = formData.get('name') as string;
  const sourceType = formData.get('sourceType') as string;
  const provider = (formData.get('provider') as string) || 'elevenlabs';
  const audioFile = formData.get('audio') as File | null;

  // Hume import flow — no audio file needed
  if (provider === 'hume') {
    const externalVoiceId = formData.get('externalVoiceId') as string;
    const importParsed = importVoiceSchema.safeParse({ name, externalVoiceId, provider });
    if (!importParsed.success) {
      return errorResponse(importParsed.error.flatten(), 400);
    }

    const voiceClone = await prisma.voiceClone.create({
      data: {
        userId: session.user.id,
        name: importParsed.data.name,
        provider: 'hume',
        externalVoiceId: importParsed.data.externalVoiceId,
        sourceType: 'IMPORT',
        verificationStatus: 'ADMIN_VERIFIED',
      },
    });

    return NextResponse.json(voiceClone, { status: 201 });
  }

  const parsed = cloneVoiceSchema.safeParse({ name, sourceType });
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  if (!audioFile) {
    return errorResponse('Audio file is required', 400);
  }

  const arrayBuffer = await audioFile.arrayBuffer();
  const audioBuffer = Buffer.from(arrayBuffer);

  if (audioBuffer.length > MAX_AUDIO_SIZE) {
    return errorResponse('Audio file too large. Maximum size is 5MB.', 400);
  }

  // Transcode to MP3 for provider compatibility (skip if already MP3)
  const mime = audioFile.type || 'audio/mpeg';
  const ext = getExtensionFromMime(mime);
  const isMp3 = mime === 'audio/mpeg' || mime === 'audio/mp3';
  const cloneBuffer = isMp3 ? audioBuffer : await transcodeToMp3(audioBuffer, ext);

  let externalVoiceId: string;

  if (provider === 'fal') {
    const falKey = await getByokKey(session.user.id, 'fal');
    if (!falKey) {
      return errorResponse('Fal API key required for voice cloning. Add it in Settings.', 400);
    }
    const { embeddingUrl } = await cloneVoiceViaFal(falKey, cloneBuffer);
    externalVoiceId = embeddingUrl;
  } else if (provider === 'cartesia') {
    const cartesiaKey = await getByokKey(session.user.id, 'cartesia') ?? process.env.CARTESIA_API_KEY;
    if (!cartesiaKey) {
      return errorResponse('Cartesia API key required', 400);
    }
    const { voiceId } = await cloneVoiceViaCartesia(cartesiaKey, cloneBuffer, parsed.data.name);
    externalVoiceId = voiceId;
  } else {
    const elevenLabsKey = await getByokKey(session.user.id, 'elevenlabs');
    const { voiceId } = await cloneVoice(parsed.data.name, [cloneBuffer], {
      apiKeyOverride: elevenLabsKey ?? undefined,
    });
    externalVoiceId = voiceId;
  }

  logUsage({
    service: provider,
    category: 'voice_clone',
    totalCost: 0,
    userId: session.user.id,
    metadata: { audioSizeBytes: audioBuffer.length },
  });

  // Upload original sample audio to R2 for voiceprint extraction
  const sampleKey = `voice-clones/samples/${session.user.id}/${Date.now()}.${ext}`;
  const sampleUrl = await uploadFile(sampleKey, audioBuffer, mime);

  const voiceClone = await prisma.voiceClone.create({
    data: {
      userId: session.user.id,
      name: parsed.data.name,
      provider,
      externalVoiceId,
      sourceType: parsed.data.sourceType,
      sampleUrl,
      verificationStatus: 'PENDING_VERIFICATION',
    },
  });

  // Queue voice verification
  await addJob(voiceVerificationQueue, JobType.VERIFY_VOICE, {
    voiceCloneId: voiceClone.id,
    userId: session.user.id,
    action: 'extract_fingerprint',
  });

  return NextResponse.json(voiceClone, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const body = await request.json();
  const { voiceCloneId, requestable, description, priceInCents } = body;

  if (!voiceCloneId || typeof voiceCloneId !== 'string') {
    return errorResponse('voiceCloneId is required', 400);
  }

  const hasRequestable = typeof requestable === 'boolean';
  const hasDescription = typeof description === 'string';
  const hasPrice = priceInCents !== undefined;

  if (!hasRequestable && !hasDescription && !hasPrice) {
    return errorResponse('At least one of requestable, description, or priceInCents is required', 400);
  }

  if (hasDescription && description.length > 200) {
    return errorResponse('Description must be 200 characters or less', 400);
  }

  // Validate priceInCents range
  if (hasPrice && priceInCents !== null) {
    if (typeof priceInCents !== 'number' || !Number.isInteger(priceInCents) || priceInCents < 0 || priceInCents > 10000) {
      return errorResponse('Price must be an integer between 0 and 10000 cents ($0-$100)', 400);
    }
  }

  const voiceClone = await prisma.voiceClone.findUnique({
    where: { id: voiceCloneId },
  });

  if (!voiceClone) {
    return errorResponse('Voice clone not found', 404);
  }

  if (voiceClone.userId !== session.user.id) {
    return errorResponse('Forbidden', 403);
  }

  // Setting a price requires Stripe onboarding
  if (hasPrice && priceInCents !== null && priceInCents > 0) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { stripeOnboarded: true },
    });
    if (!user.stripeOnboarded) {
      return errorResponse('Connect your Stripe account before setting a price', 400);
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
    return errorResponse('Unauthorized', 401);
  }

  const body = await request.json();
  const { voiceCloneId } = body;

  if (!voiceCloneId || typeof voiceCloneId !== 'string') {
    return errorResponse('voiceCloneId is required', 400);
  }

  const voiceClone = await prisma.voiceClone.findUnique({
    where: { id: voiceCloneId },
  });

  if (!voiceClone) {
    return errorResponse('Voice clone not found', 404);
  }

  if (voiceClone.userId !== session.user.id) {
    return errorResponse('Forbidden', 403);
  }

  // Delete from external provider (skip for hume — imported voice, not ours to delete)
  if (voiceClone.provider === 'hume') {
    // Imported voice — no external cleanup needed
  } else if (!voiceClone.provider || voiceClone.provider === 'elevenlabs') {
    const elevenLabsKey = await getByokKey(session.user.id, 'elevenlabs');
    await deleteClonedVoice(voiceClone.externalVoiceId, elevenLabsKey ?? undefined);
  } else if (voiceClone.provider === 'cartesia') {
    const cartesiaKey = await getByokKey(session.user.id, 'cartesia') ?? process.env.CARTESIA_API_KEY;
    if (cartesiaKey) {
      const { deleteCartesiaVoice } = await import('@/lib/cartesia-voice-clone');
      await deleteCartesiaVoice(cartesiaKey, voiceClone.externalVoiceId);
    }
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
