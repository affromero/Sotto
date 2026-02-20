import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { uploadFile } from '@/lib/r2';
import { addJob, voiceVerificationQueue, JobType } from '@/lib/queue';
import { voiceVerifyChallengeSchema } from '@/lib/validations';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const voiceCloneId = request.nextUrl.searchParams.get('voiceCloneId');
  if (!voiceCloneId) {
    return NextResponse.json({ error: 'voiceCloneId is required' }, { status: 400 });
  }

  const voiceClone = await prisma.voiceClone.findUnique({
    where: { id: voiceCloneId },
    select: { userId: true, verificationStatus: true },
  });

  if (!voiceClone) {
    return NextResponse.json({ error: 'Voice clone not found' }, { status: 404 });
  }

  if (voiceClone.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (voiceClone.verificationStatus !== 'AWAITING_CHALLENGE') {
    return NextResponse.json({ challenge: null });
  }

  const challenge = await prisma.voiceVerificationChallenge.findFirst({
    where: { voiceCloneId, passed: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      phrase: true,
      attemptNumber: true,
      expiresAt: true,
    },
  });

  return NextResponse.json({ challenge });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await request.formData();
  const voiceCloneId = formData.get('voiceCloneId') as string;
  const audio = formData.get('audio') as File | null;

  const parsed = voiceVerifyChallengeSchema.safeParse({ voiceCloneId });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (!audio) {
    return NextResponse.json({ error: 'Audio recording is required' }, { status: 400 });
  }

  const voiceClone = await prisma.voiceClone.findUnique({
    where: { id: voiceCloneId },
    select: { userId: true, verificationStatus: true },
  });

  if (!voiceClone) {
    return NextResponse.json({ error: 'Voice clone not found' }, { status: 404 });
  }

  if (voiceClone.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (voiceClone.verificationStatus !== 'AWAITING_CHALLENGE') {
    return NextResponse.json(
      { error: 'Voice is not awaiting challenge' },
      { status: 409 }
    );
  }

  const challenge = await prisma.voiceVerificationChallenge.findFirst({
    where: { voiceCloneId, passed: null },
    orderBy: { createdAt: 'desc' },
  });

  if (!challenge) {
    return NextResponse.json({ error: 'No active challenge found' }, { status: 409 });
  }

  if (new Date() > challenge.expiresAt) {
    return NextResponse.json({ error: 'Challenge has expired' }, { status: 410 });
  }

  const arrayBuffer = await audio.arrayBuffer();
  const audioBuffer = Buffer.from(arrayBuffer);

  const recordingKey = `voice-clones/${voiceCloneId}/challenge-${challenge.attemptNumber}.webm`;
  const recordingUrl = await uploadFile(recordingKey, audioBuffer, 'audio/webm');

  await prisma.$transaction([
    prisma.voiceVerificationChallenge.update({
      where: { id: challenge.id },
      data: { recordingUrl },
    }),
    prisma.voiceClone.update({
      where: { id: voiceCloneId },
      data: { verificationStatus: 'CHALLENGE_SUBMITTED' },
    }),
  ]);

  await addJob(voiceVerificationQueue, JobType.VERIFY_VOICE, {
    voiceCloneId,
    userId: session.user.id,
    action: 'verify_challenge',
    challengeId: challenge.id,
  });

  return NextResponse.json({ submitted: true });
}
