import { Job } from 'bullmq';
import type { VerifyVoicePayload } from '@/lib/queue';
import { addJob, voiceVerificationQueue, notificationQueue, JobType } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { downloadFile, deleteFile } from '@/lib/r2';
import { deleteClonedVoice } from '@/lib/elevenlabs';
import { deleteCartesiaVoice } from '@/lib/cartesia-voice-clone';
import { extractVoiceprint, findDuplicateVoiceprints, verifyChallenge } from '@/lib/voice-fingerprint';
import { generateChallengePhrase, CHALLENGE_EXPIRY_MS, MAX_CHALLENGE_ATTEMPTS } from '@/lib/voice-challenge-phrases';
import { getByokKey } from '@/lib/byok';
import { logger } from '@/lib/logger';

export async function processVoiceVerification(job: Job<VerifyVoicePayload>): Promise<void> {
  const { voiceCloneId, userId, action, challengeId } = job.data;

  logger.info('Voice verification job started', { voiceCloneId, action });

  switch (action) {
    case 'extract_fingerprint':
      await handleExtractFingerprint(voiceCloneId, userId);
      break;
    case 'check_duplicates':
      await handleCheckDuplicates(voiceCloneId, userId);
      break;
    case 'verify_challenge':
      await handleVerifyChallenge(voiceCloneId, userId, challengeId);
      break;
  }
}

async function handleExtractFingerprint(voiceCloneId: string, userId: string) {
  const voiceClone = await prisma.voiceClone.findUnique({
    where: { id: voiceCloneId },
    select: { sampleUrl: true },
  });

  if (!voiceClone?.sampleUrl) {
    // Imported voices (e.g. Hume) have no sample audio — mark as verified
    await prisma.voiceClone.update({
      where: { id: voiceCloneId },
      data: { verificationStatus: 'ADMIN_VERIFIED' },
    });
    logger.info('Imported voice auto-verified (no sample)', { voiceCloneId });
    return;
  }

  const audioBuffer = await downloadFile(voiceClone.sampleUrl);
  const embedding = await extractVoiceprint(audioBuffer);

  await prisma.voiceFingerprint.upsert({
    where: { voiceCloneId },
    create: {
      voiceCloneId,
      embedding,
      modelVersion: 'wespeaker-cam++-lm-v1',
      audioUrl: voiceClone.sampleUrl,
    },
    update: {
      embedding,
      modelVersion: 'wespeaker-cam++-lm-v1',
      audioUrl: voiceClone.sampleUrl,
    },
  });

  logger.info('Voiceprint extracted', { voiceCloneId, dim: embedding.length });

  await addJob(voiceVerificationQueue, JobType.VERIFY_VOICE, {
    voiceCloneId,
    userId,
    action: 'check_duplicates',
  });
}

async function handleCheckDuplicates(voiceCloneId: string, userId: string) {
  const fingerprint = await prisma.voiceFingerprint.findUnique({
    where: { voiceCloneId },
    select: { embedding: true },
  });

  if (!fingerprint) {
    throw new Error(`No fingerprint for voice clone ${voiceCloneId}`);
  }

  const matches = await findDuplicateVoiceprints(fingerprint.embedding, voiceCloneId);

  if (matches.length > 0) {
    const topMatch = matches[0];

    await prisma.voiceClone.update({
      where: { id: voiceCloneId },
      data: { verificationStatus: 'BLOCKED' },
    });

    await prisma.voiceSimilarityMatch.create({
      data: {
        matchedVoiceId: topMatch.voiceCloneId,
        blockedVoiceId: voiceCloneId,
        similarity: topMatch.similarity,
      },
    });

    // Clean up the blocked voice from external provider
    const voiceClone = await prisma.voiceClone.findUnique({
      where: { id: voiceCloneId },
      select: { provider: true, externalVoiceId: true, sampleUrl: true, userId: true },
    });

    if (voiceClone) {
      if (!voiceClone.provider || voiceClone.provider === 'elevenlabs') {
        const byokKey = await getByokKey(voiceClone.userId, 'elevenlabs');
        await deleteClonedVoice(voiceClone.externalVoiceId, byokKey ?? undefined).catch((err) =>
          logger.error('Failed to delete blocked voice from ElevenLabs', { error: err.message })
        );
      } else if (voiceClone.provider === 'cartesia') {
        const cartesiaKey = await getByokKey(voiceClone.userId, 'cartesia') ?? process.env.CARTESIA_API_KEY;
        if (cartesiaKey) {
          await deleteCartesiaVoice(cartesiaKey, voiceClone.externalVoiceId).catch((err) =>
            logger.error('Failed to delete blocked voice from Cartesia', { error: err.message })
          );
        }
      }
      if (voiceClone.sampleUrl) {
        await deleteFile(voiceClone.sampleUrl).catch((err) =>
          logger.error('Failed to delete sample audio', { error: err.message })
        );
      }
    }

    // Notify the uploader
    await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
      userId,
      type: 'VOICE_BLOCKED_DUPLICATE',
      title: 'Voice Clone Blocked',
      message: 'Your voice clone was blocked because it matches an existing verified voice.',
    });

    // Notify the matched voice owner
    const matchedVoice = await prisma.voiceClone.findUnique({
      where: { id: topMatch.voiceCloneId },
      select: { userId: true, name: true },
    });

    if (matchedVoice) {
      await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
        userId: matchedVoice.userId,
        type: 'VOICE_OWNERSHIP_ALERT',
        title: 'Voice Impersonation Blocked',
        message: `Someone tried to clone a voice matching your "${matchedVoice.name}" voice. We blocked it automatically.`,
      });
    }

    logger.info('Voice blocked as duplicate', {
      voiceCloneId,
      matchedVoiceId: topMatch.voiceCloneId,
      similarity: topMatch.similarity,
    });
    return;
  }

  // No duplicates — proceed to challenge
  const phrase = generateChallengePhrase();

  await prisma.$transaction([
    prisma.voiceClone.update({
      where: { id: voiceCloneId },
      data: { verificationStatus: 'AWAITING_CHALLENGE' },
    }),
    prisma.voiceVerificationChallenge.create({
      data: {
        voiceCloneId,
        phrase,
        attemptNumber: 1,
        expiresAt: new Date(Date.now() + CHALLENGE_EXPIRY_MS),
      },
    }),
  ]);

  await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
    userId,
    type: 'VOICE_VERIFICATION_REQUIRED',
    title: 'Voice Verification Required',
    message: 'Your voice clone needs verification. Record a short phrase to prove ownership.',
  });

  logger.info('Challenge created for voice', { voiceCloneId });
}

async function handleVerifyChallenge(voiceCloneId: string, userId: string, challengeId?: string) {
  const challenge = await prisma.voiceVerificationChallenge.findFirst({
    where: {
      voiceCloneId,
      ...(challengeId ? { id: challengeId } : {}),
      recordingUrl: { not: null },
      passed: null,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!challenge?.recordingUrl) {
    throw new Error(`No challenge recording found for voice clone ${voiceCloneId}`);
  }

  const audioBuffer = await downloadFile(challenge.recordingUrl);
  const liveEmbedding = await extractVoiceprint(audioBuffer);
  const { similarity, passed } = await verifyChallenge(liveEmbedding, voiceCloneId);

  await prisma.voiceVerificationChallenge.update({
    where: { id: challenge.id },
    data: { similarity, passed },
  });

  if (passed) {
    await prisma.voiceClone.update({
      where: { id: voiceCloneId },
      data: { verificationStatus: 'VERIFIED' },
    });

    await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
      userId,
      type: 'VOICE_VERIFICATION_PASSED',
      title: 'Voice Verified',
      message: 'Your voice clone has been verified and is ready to use.',
    });

    logger.info('Voice verified', { voiceCloneId, similarity });
    return;
  }

  // Failed — check if retries available
  if (challenge.attemptNumber < MAX_CHALLENGE_ATTEMPTS) {
    const phrase = generateChallengePhrase();

    await prisma.$transaction([
      prisma.voiceClone.update({
        where: { id: voiceCloneId },
        data: { verificationStatus: 'AWAITING_CHALLENGE' },
      }),
      prisma.voiceVerificationChallenge.create({
        data: {
          voiceCloneId,
          phrase,
          attemptNumber: challenge.attemptNumber + 1,
          expiresAt: new Date(Date.now() + CHALLENGE_EXPIRY_MS),
        },
      }),
    ]);

    await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
      userId,
      type: 'VOICE_VERIFICATION_REQUIRED',
      title: 'Verification Failed — Try Again',
      message: `Voice verification failed (attempt ${challenge.attemptNumber} of ${MAX_CHALLENGE_ATTEMPTS}). Please try again with a new phrase.`,
    });

    logger.info('Challenge failed, retry available', {
      voiceCloneId,
      similarity,
      attempt: challenge.attemptNumber,
    });
    return;
  }

  // Max attempts reached — reject
  await prisma.voiceClone.update({
    where: { id: voiceCloneId },
    data: { verificationStatus: 'REJECTED' },
  });

  // Clean up
  const voiceClone = await prisma.voiceClone.findUnique({
    where: { id: voiceCloneId },
    select: { provider: true, externalVoiceId: true, sampleUrl: true, userId: true },
  });

  if (voiceClone) {
    if (!voiceClone.provider || voiceClone.provider === 'elevenlabs') {
      const byokKey = await getByokKey(voiceClone.userId, 'elevenlabs');
      await deleteClonedVoice(voiceClone.externalVoiceId, byokKey ?? undefined).catch((err) =>
        logger.error('Failed to delete rejected voice from ElevenLabs', { error: err.message })
      );
    } else if (voiceClone.provider === 'cartesia') {
      const cartesiaKey = await getByokKey(voiceClone.userId, 'cartesia') ?? process.env.CARTESIA_API_KEY;
      if (cartesiaKey) {
        await deleteCartesiaVoice(cartesiaKey, voiceClone.externalVoiceId).catch((err) =>
          logger.error('Failed to delete rejected voice from Cartesia', { error: err.message })
        );
      }
    }
    if (voiceClone.sampleUrl) {
      await deleteFile(voiceClone.sampleUrl).catch((err) =>
        logger.error('Failed to delete sample audio', { error: err.message })
      );
    }
  }

  await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
    userId,
    type: 'VOICE_VERIFICATION_FAILED',
    title: 'Voice Verification Failed',
    message: 'Your voice clone could not be verified after 3 attempts and has been removed.',
  });

  logger.info('Voice rejected after max attempts', { voiceCloneId, similarity });
}
