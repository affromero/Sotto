import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { cloneVoice, deleteClonedVoice, getVoiceById } from '@/lib/elevenlabs';
import { cloneVoiceViaFal } from '@/lib/fal-voice-clone';
import { cloneVoiceViaCartesia } from '@/lib/cartesia-voice-clone';
import { getByokKey, hasByokKey } from '@/lib/byok';
import { cloneVoiceSchema, importVoiceSchema, importElevenLabsVoiceSchema } from '@/lib/validations';
import { MAX_VOICE_CLONES } from '@/lib/generation-limits';
import { getTierFeatures } from '@/lib/tier-features';
import { getPlanFeatureConfig } from '@/lib/plan-feature-config';
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
  const [user, isByok, voiceConfig] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { plan: true, role: true },
    }),
    hasByokKey(session.user.id),
    getPlanFeatureConfig(),
  ]);
  const tierFeatures = getTierFeatures(user.plan as 'FREE' | 'PRO', isByok, user.role, voiceConfig);
  if (!tierFeatures.voiceCloningEnabled) {
    return errorResponse('Voice cloning requires a Pro subscription.', 403);
  }

  const existingCount = await prisma.voiceClone.count({
    where: { userId: session.user.id },
  });

  if (existingCount >= MAX_VOICE_CLONES) {
    return errorResponse(`Maximum of ${MAX_VOICE_CLONES} voice clones allowed`, 403);
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

  // ElevenLabs import flow — validate voice ID, fetch name from EL API
  if (provider === 'elevenlabs' && sourceType === 'IMPORT') {
    const externalVoiceId = formData.get('externalVoiceId') as string;
    const parsed = importElevenLabsVoiceSchema.safeParse({ externalVoiceId, provider });
    if (!parsed.success) return errorResponse(parsed.error.flatten(), 400);

    const elevenLabsKey = await getByokKey(session.user.id, 'elevenlabs');

    let voiceInfo: { name: string; labels: Record<string, string> } | null = null;
    try {
      // Try BYOK key first (accesses private voices); fall back to platform key
      voiceInfo = elevenLabsKey
        ? await getVoiceById(parsed.data.externalVoiceId, elevenLabsKey)
        : await getVoiceById(parsed.data.externalVoiceId);

      // If BYOK was tried and didn't find it, fall back to platform key (voice may be public)
      if (!voiceInfo && elevenLabsKey) {
        voiceInfo = await getVoiceById(parsed.data.externalVoiceId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      const isInvalidId = msg.includes('422') || msg.toLowerCase().includes('pattern') || msg.toLowerCase().includes('invalid');
      return errorResponse(isInvalidId ? 'Invalid ElevenLabs voice ID format.' : 'Failed to look up voice ID.', 400);
    }

    if (!voiceInfo) {
      const hint = elevenLabsKey
        ? 'Voice ID not found on ElevenLabs.'
        : 'Voice ID not found. Add your ElevenLabs API key in Settings to access private voices.';
      return errorResponse(hint, 404);
    }

    // Check for duplicate using the unique constraint [userId, provider, externalVoiceId]
    const existing = await prisma.voiceClone.findUnique({
      where: {
        userId_provider_externalVoiceId: {
          userId: session.user.id,
          provider: 'elevenlabs',
          externalVoiceId: parsed.data.externalVoiceId,
        },
      },
    });
    if (existing) return errorResponse('This voice ID is already in your library.', 409);

    const voiceClone = await prisma.voiceClone.create({
      data: {
        userId: session.user.id,
        name: voiceInfo.name,
        provider: 'elevenlabs',
        externalVoiceId: parsed.data.externalVoiceId,
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
  const { voiceCloneId, description } = body;

  if (!voiceCloneId || typeof voiceCloneId !== 'string') {
    return errorResponse('voiceCloneId is required', 400);
  }

  if (typeof description !== 'string') {
    return errorResponse('description is required', 400);
  }

  if (description.length > 200) {
    return errorResponse('Description must be 200 characters or less', 400);
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

  const updated = await prisma.voiceClone.update({
    where: { id: voiceCloneId },
    data: { description },
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
    if (voiceClone.sourceType !== 'IMPORT') {
      const elevenLabsKey = await getByokKey(session.user.id, 'elevenlabs');
      await deleteClonedVoice(voiceClone.externalVoiceId, elevenLabsKey ?? undefined);
    }
    // IMPORT = we referenced their voice, not a clone we created — skip external deletion
  } else if (voiceClone.provider === 'cartesia') {
    const cartesiaKey = await getByokKey(session.user.id, 'cartesia') ?? process.env.CARTESIA_API_KEY;
    if (cartesiaKey) {
      const { deleteCartesiaVoice } = await import('@/lib/cartesia-voice-clone');
      await deleteCartesiaVoice(cartesiaKey, voiceClone.externalVoiceId);
    }
  }

  await prisma.voiceClone.delete({
    where: { id: voiceCloneId },
  });

  return NextResponse.json({ success: true });
}
