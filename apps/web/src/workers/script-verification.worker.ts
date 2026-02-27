import { Job } from 'bullmq';
import {
  VerifyScriptPayload,
  addJob,
  JobType,
  referenceValidationQueue,
  notificationQueue,
  scriptVerificationQueue,
} from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { markPodcastFailed } from '@/lib/pipeline-resume';
import { verifyScript, type ClaimAnalysis } from '@/lib/script-verifier';
import {
  generateScriptWithFeedback,
  type ScriptTurn,
  type GeneratedReference,
  type SourceMetadata,
} from '@/lib/script-generator';
import { createSegmentsAndQueueAudio } from '@/lib/segment-creator';
import { logUsage } from '@/lib/usage-logger';
import { getAiKey, hasByokKey } from '@/lib/byok';
import { resolveAiModelAndProvider } from '@/lib/providers/ai-registry';
import { getTierFeatures } from '@/lib/tier-features';
import { logger } from '@/lib/logger';

const MAX_VERIFICATION_ATTEMPTS = 3;

export async function processScriptVerification(job: Job<VerifyScriptPayload>): Promise<void> {
  const { podcastId, userId, discoveryId, useAdminCredits } = job.data;

  logger.info('Starting script verification', { podcastId });
  await job.updateProgress(5);

  const [aiKey, hasTts, userPlan] = await Promise.all([
    useAdminCredits ? Promise.resolve(null) : getAiKey(userId),
    useAdminCredits ? Promise.resolve(true) : hasByokKey(userId),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { plan: true, role: true } }),
  ]);

  const tierFeatures = getTierFeatures(userPlan.plan as 'FREE' | 'PRO', hasTts, userPlan.role);

  const [script, discovery, references, podcastRecord] = await Promise.all([
    prisma.script.findUniqueOrThrow({
      where: { podcastId },
    }),
    prisma.discovery.findUniqueOrThrow({
      where: { id: discoveryId },
    }),
    prisma.reference.findMany({
      where: { podcastId },
      orderBy: { number: 'asc' },
    }),
    prisma.podcast.findUniqueOrThrow({
      where: { id: podcastId },
      select: { aiModel: true, verificationMode: true },
    }),
  ]);

  const verificationMode = podcastRecord.verificationMode;

  // Model + provider resolved together — prevents sending e.g. gpt-5-mini to Anthropic
  const { model, provider } = await resolveAiModelAndProvider({
    podcastAiModel: podcastRecord.aiModel,
    aiKey,
    plan: userPlan.plan as 'FREE' | 'PRO',
  });

  const requestedDuration = discovery.durationTarget || 10;
  const maxDurationMinutes = isFinite(tierFeatures.maxDurationMinutes)
    ? Math.min(requestedDuration, tierFeatures.maxDurationMinutes)
    : requestedDuration;

  let turns = script.turns as ScriptTurn[];
  const generatedRefs: GeneratedReference[] = references.map((r) => ({
    number: r.number,
    title: r.title,
    authors: r.authors,
    year: r.year,
    url: r.url,
    type: r.type as GeneratedReference['type'],
    publisher: r.publisher,
    doi: r.doi,
  }));

  const attemptNumber = script.verificationAttempts + 1;
  const previousClaims = (script.verificationClaims as unknown as ClaimAnalysis[]) ?? [];

  await job.updateProgress(15);

  const verdict = await verifyScript({
    topic: discovery.topic || '',
    turns,
    references: generatedRefs,
    depth: discovery.depth || 'standard',
    audienceLevel: discovery.audienceLevel || 'intermediate',
    attemptNumber,
    maxDurationMinutes,
    previousFeedback: script.verificationFeedback || undefined,
    apiKeyOverride: aiKey?.apiKey,
    model,
    previousClaims: previousClaims.length > 0 ? previousClaims : undefined,
    verificationMode,
  });

  await job.updateProgress(50);

  await logUsage({
    service: provider,
    model: verdict.model,
    category: 'script_verification',
    inputTokens: verdict.inputTokens,
    outputTokens: verdict.outputTokens,
    podcastId,
    userId,
  });

  logger.info('Script verification result', {
    podcastId,
    passed: String(verdict.passed),
    score: String(verdict.score),
    attempt: String(attemptNumber),
    totalClaims: String(verdict.totalClaims),
    unsupported: String(verdict.unsupportedClaims.length),
    unreliable: String(verdict.unreliableSourceClaims.length),
    refCount: String(verdict.referenceQuality.totalCount),
    refRequired: String(verdict.referenceQuality.requiredCount),
    refCountPassed: String(verdict.referenceQuality.countPassed),
    refSeriousRatio: String(verdict.referenceQuality.seriousRatio.toFixed(2)),
    refQualityScore: String(verdict.referenceQuality.qualityScore.toFixed(2)),
  });

  if (verdict.passed) {
    await prisma.script.update({
      where: { podcastId },
      data: {
        verificationAttempts: attemptNumber,
        verificationClaims: Prisma.JsonNull,
      },
    });

    // Auto-adjust duration if script is too long/short (don't waste a verification attempt)
    if (verdict.durationFeedback) {
      logger.info('Script passed fact-check but needs duration adjustment', {
        podcastId,
        durationFeedback: verdict.durationFeedback,
      });

      const sourceMetadata = discovery.sourceMetadata as SourceMetadata | null;

      const adjusted = await generateScriptWithFeedback({
        topic: discovery.topic || '',
        depth: discovery.depth || 'standard',
        audienceLevel: discovery.audienceLevel || 'intermediate',
        audience: discovery.audience || 'general',
        focusAreas: discovery.focusAreas,
        tone: discovery.tone || 'casual',
        durationTarget: discovery.durationTarget || 10,
        sourceContent: discovery.sourceContent || undefined,
        sourceMetadata: sourceMetadata || undefined,
        speakers: (discovery.speakers as Array<{ name: string; description: string }>) || undefined,
        previousScript: turns,
        previousReferences: generatedRefs,
        verificationFeedback: `DURATION: ${verdict.durationFeedback}`,
        apiKeyOverride: aiKey?.apiKey,
        model,
        webSearchEnabled: tierFeatures.webSearchEnabled,
      });

      await logUsage({
        service: provider,
        model: adjusted.model,
        category: 'script_generation',
        inputTokens: adjusted.inputTokens,
        outputTokens: adjusted.outputTokens,
        podcastId,
        userId,
      });

      // Save adjusted script
      await prisma.script.update({
        where: { podcastId },
        data: {
          turns: adjusted.turns,
          soundCues: adjusted.soundCues.length > 0 ? adjusted.soundCues : undefined,
          markdown: adjusted.markdown,
          version: { increment: 1 },
        },
      });

      // Update references if changed
      if (adjusted.references.length > 0) {
        await prisma.reference.deleteMany({ where: { podcastId } });
        await prisma.reference.createMany({
          data: adjusted.references.map((ref) => ({
            podcastId,
            number: ref.number,
            title: ref.title,
            authors: ref.authors,
            year: ref.year,
            url: ref.url,
            type: ref.type,
            publisher: ref.publisher,
            doi: ref.doi,
          })),
        });
      }

      // Use adjusted turns for downstream routing
      turns = adjusted.turns;

      logger.info('Script duration adjusted', { podcastId });
    }

    if (references.length > 0) {
      await prisma.podcast.update({
        where: { id: podcastId },
        data: { status: 'VALIDATING_REFERENCES' },
      });

      await addJob(referenceValidationQueue, JobType.VALIDATE_REFERENCES, {
        podcastId,
        userId,
        useAdminCredits,
      });

      logger.info('Script verified, routing to reference validation', { podcastId });
    } else {
      // No references — check source to decide whether to pause for review
      const podcast = await prisma.podcast.findUniqueOrThrow({
        where: { id: podcastId },
        select: { source: true },
      });

      // Free users auto-approve (no script review pause)
      const shouldAutoApprove = tierFeatures.autoApproveScript ||
        (podcast.source !== 'WEB' && podcast.source !== 'IMPORT');

      if (!shouldAutoApprove) {
        // Pause for user review (Pro/BYOK users on WEB/IMPORT)
        await prisma.podcast.update({
          where: { id: podcastId },
          data: { status: 'SCRIPT_READY' },
        });

        await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
          userId,
          type: 'SCRIPT_READY',
          title: 'Script ready for review',
          message: 'Your podcast script is ready. Review and approve it to start audio generation.',
          data: { podcastId },
        });

        logger.info('Script verified (no refs), paused at SCRIPT_READY for review', { podcastId });
      } else {
        // Auto-approve for TWITTER/API sources (no user at browser)
        const scriptTurns = turns as Array<{ speaker: string; text: string; direction?: string }>;
        await createSegmentsAndQueueAudio(podcastId, scriptTurns);

        await prisma.podcast.update({
          where: { id: podcastId },
          data: { status: 'GENERATING_AUDIO' },
        });

        logger.info('Script verified (no refs), auto-approved for audio generation', { podcastId });
      }
    }

    await job.updateProgress(100);
    return;
  }

  // Script failed verification
  if (attemptNumber >= MAX_VERIFICATION_ATTEMPTS) {
    await markPodcastFailed(podcastId, {
      failureReason: "Our fact-checker found issues that couldn't be resolved after 3 attempts. Please try again with a different topic or approach.",
      technicalError: `Verification failed ${attemptNumber}/${MAX_VERIFICATION_ATTEMPTS}: ${verdict.feedback}`,
    });

    await prisma.script.update({
      where: { podcastId },
      data: {
        verificationAttempts: attemptNumber,
        verificationFeedback: verdict.feedback,
        verificationClaims: verdict.allClaims as unknown as Prisma.InputJsonValue,
      },
    });

    await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
      userId,
      type: 'PODCAST_READY',
      title: 'Podcast generation failed',
      message:
        "Our fact-checker found issues that couldn't be resolved after 3 attempts. Please try again with a different topic or approach.",
      data: { podcastId },
    });

    logger.error('Script verification failed after max attempts', {
      podcastId,
      attempts: String(attemptNumber),
      score: String(verdict.score),
    });

    await job.updateProgress(100);
    return;
  }

  // Revision loop: regenerate script with feedback
  await job.updateProgress(60);

  await prisma.script.update({
    where: { podcastId },
    data: {
      verificationAttempts: attemptNumber,
      verificationFeedback: verdict.feedback,
      verificationClaims: verdict.allClaims as unknown as Prisma.InputJsonValue,
    },
  });

  logger.info('Regenerating script with feedback', {
    podcastId,
    attempt: String(attemptNumber),
    feedback: verdict.feedback.substring(0, 200),
  });

  const sourceMetadata = discovery.sourceMetadata as SourceMetadata | null;

  const revised = await generateScriptWithFeedback({
    topic: discovery.topic || '',
    depth: discovery.depth || 'standard',
    audienceLevel: discovery.audienceLevel || 'intermediate',
    audience: discovery.audience || 'general',
    focusAreas: discovery.focusAreas,
    tone: discovery.tone || 'casual',
    durationTarget: discovery.durationTarget || 10,
    sourceContent: discovery.sourceContent || undefined,
    sourceMetadata: sourceMetadata || undefined,
    speakers: (discovery.speakers as Array<{ name: string; description: string }>) || undefined,
    previousScript: turns,
    previousReferences: generatedRefs,
    verificationFeedback: verdict.feedback,
    apiKeyOverride: aiKey?.apiKey,
    model,
    webSearchEnabled: tierFeatures.webSearchEnabled,
  });

  await job.updateProgress(80);

  await logUsage({
    service: provider,
    model: revised.model,
    category: 'script_generation',
    inputTokens: revised.inputTokens,
    outputTokens: revised.outputTokens,
    podcastId,
    userId,
  });

  // Save revised script (increment version)
  await prisma.script.update({
    where: { podcastId },
    data: {
      turns: revised.turns,
      soundCues: revised.soundCues.length > 0 ? revised.soundCues : undefined,
      markdown: revised.markdown,
      version: { increment: 1 },
    },
  });

  // Replace references only if the revision produced new ones — otherwise keep
  // the old set so the next verification pass doesn't see 0 references.
  if (revised.references.length > 0) {
    await prisma.reference.deleteMany({ where: { podcastId } });
    await prisma.reference.createMany({
      data: revised.references.map((ref) => ({
        podcastId,
        number: ref.number,
        title: ref.title,
        authors: ref.authors,
        year: ref.year,
        url: ref.url,
        type: ref.type,
        publisher: ref.publisher,
        doi: ref.doi,
      })),
    });
  } else {
    logger.warn('Revision produced 0 references, keeping previous set', { podcastId });
  }

  await job.updateProgress(90);

  // Re-queue for another verification pass
  await addJob(scriptVerificationQueue, JobType.VERIFY_SCRIPT, {
    podcastId,
    userId,
    discoveryId,
    useAdminCredits,
  });

  logger.info('Script revised and re-queued for verification', {
    podcastId,
    attempt: String(attemptNumber),
    newReferences: String(revised.references.length),
  });

  await job.updateProgress(100);
}
