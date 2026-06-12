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
import { markEpisodeFailed } from '@/lib/pipeline-resume';
import { invalidateEpisodeCache, publishEpisodeStatus } from '@/lib/redis';
import { verifyScript, type ClaimAnalysis } from '@/lib/script-verifier';
import {
  generateScriptWithFeedback,
  type ScriptTurn,
  type GeneratedReference,
  type SourceMetadata,
} from '@/lib/script-generator';
import { createSegmentsAndQueueAudio } from '@/lib/segment-creator';
import { convertTurnsForProvider } from '@/lib/tts-tag-converter';
import { logUsage } from '@/lib/usage-logger';
import { getAiKey } from '@/lib/byok';
import { resolveAiModelAndProvider, type AiProviderId } from '@/lib/providers/ai-registry';
import { assignVoicesForEpisode } from '@/lib/voice-assigner';
import type { TtsProviderId } from '@/lib/providers/tts-registry';
import { getGenerationFeatures } from '@/lib/generation-features';
import { getAutoModelConfig } from '@/lib/auto-model-config';
import { logger } from '@/lib/logger';
import { logPipelineStageComplete } from '@/lib/pipeline-events';
import { buildRenumberMap, cleanAndRenumberCitations } from '@/lib/script-updater';

const MAX_VERIFICATION_ATTEMPTS = 4;

/** Each attempt uses a progressively more aggressive repair strategy. */
type RepairMode = 'replace_sources' | 'rewrite_to_sources' | 'drop_unverifiable';

function getRepairMode(attempt: number): RepairMode {
  if (attempt <= 1) return 'replace_sources';
  if (attempt === 2) return 'rewrite_to_sources';
  return 'drop_unverifiable';
}

export async function processScriptVerification(job: Job<VerifyScriptPayload>): Promise<void> {
  const { episodeId, userId, discoveryId, useAdminCredits } = job.data;

  logger.info('Starting script verification', { episodeId });
  await job.updateProgress(5);

  const genFeatures = getGenerationFeatures();

  const [script, discovery, references, episodeRecord] = await Promise.all([
    prisma.script.findUniqueOrThrow({
      where: { episodeId },
    }),
    prisma.discovery.findUniqueOrThrow({
      where: { id: discoveryId },
    }),
    prisma.reference.findMany({
      where: { episodeId },
      orderBy: { number: 'asc' },
    }),
    prisma.episode.findUniqueOrThrow({
      where: { id: episodeId },
      select: { aiModel: true, verificationMode: true, language: true, source: true },
    }),
  ]);

  const verificationMode = episodeRecord.verificationMode;

  let turns = script.turns as ScriptTurn[];

  const aiKey = useAdminCredits || episodeRecord.aiModel ? null : await getAiKey(userId);
  if (!episodeRecord.aiModel && !aiKey) {
    throw new Error('AI model is required for script verification when no AI key is configured.');
  }

  // Model + provider resolved together — prevents sending e.g. gpt-5-mini to Anthropic
  const { model, provider } = await resolveAiModelAndProvider({
    episodeAiModel: episodeRecord.aiModel,
    aiKey,
  });

  const verificationModel = model;

  const providerAiKey =
    episodeRecord.aiModel && provider !== 'claude-code' && !useAdminCredits
      ? await getAiKey(userId, provider as AiProviderId)
      : aiKey;
  if (episodeRecord.aiModel && provider !== 'claude-code' && !useAdminCredits && !providerAiKey) {
    throw new Error(`AI key for provider "${provider}" is required for script verification.`);
  }

  const requestedDuration = discovery.durationTarget || 10;
  const maxDurationMinutes = isFinite(genFeatures.maxDurationMinutes)
    ? Math.min(requestedDuration, genFeatures.maxDurationMinutes)
    : requestedDuration;

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
    tone: discovery.tone || 'casual',
    durationTarget: discovery.durationTarget || 10,
    previousFeedback: script.verificationFeedback || undefined,
    apiKeyOverride: providerAiKey?.apiKey,
    model: verificationModel,
    provider,
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
    episodeId,
    userId,
  });

  logger.info('Script verification result', {
    episodeId,
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
    ...(verdict.failureType ? { failureType: verdict.failureType } : {}),
  });

  // Parse errors are a provider output issue, not a script quality issue.
  // Retry once without counting as a verification attempt. If consecutive,
  // fall through to the normal failure path.
  if (verdict.failureType === 'parse_error') {
    const previousWasParseError = script.verificationFeedback?.startsWith('PARSE_ERROR');
    if (!previousWasParseError) {
      logger.warn('Parse error on verification — retrying without incrementing attempts', { episodeId });
      await prisma.script.update({
        where: { episodeId },
        data: { verificationFeedback: verdict.feedback },
      });
      await addJob(scriptVerificationQueue, JobType.VERIFY_SCRIPT,
        { episodeId, userId, discoveryId, useAdminCredits },
        { jobId: `verify-${episodeId}-parse-retry-${Date.now()}` });
      await job.updateProgress(100);
      return;
    }
    // Consecutive parse errors — fall through to normal failure path
    logger.error('Consecutive parse errors on verification — treating as failure', { episodeId });
  }

  if (verdict.passed) {
    await prisma.script.update({
      where: { episodeId },
      data: {
        verificationAttempts: attemptNumber,
        verificationClaims: Prisma.JsonNull,
      },
    });

    // Auto-adjust duration if script is too long/short (don't waste a verification attempt)
    if (verdict.durationFeedback) {
      logger.info('Script passed fact-check but needs duration adjustment', {
        episodeId,
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
        apiKeyOverride: providerAiKey?.apiKey,
        model,
        provider,
        webSearchEnabled: false,
        targetLanguage: episodeRecord.language,
        languageMode: null,
      });

      await logUsage({
        service: provider,
        model: adjusted.model,
        category: 'script_generation',
        inputTokens: adjusted.inputTokens,
        outputTokens: adjusted.outputTokens,
        episodeId,
        userId,
      });

      // Save adjusted script
      await prisma.script.update({
        where: { episodeId },
        data: {
          turns: adjusted.turns,
          soundCues: adjusted.soundCues.length > 0 ? adjusted.soundCues : undefined,
          markdown: adjusted.markdown,
          version: { increment: 1 },
        },
      });

      // Update references if changed
      if (adjusted.references.length > 0) {
        await prisma.reference.deleteMany({ where: { episodeId } });
        await prisma.reference.createMany({
          data: adjusted.references.map((ref) => ({
            episodeId,
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

      // Sync vocabulary entries with the adjusted script
      await prisma.vocabularyEntry.deleteMany({ where: { episodeId } });
      if (adjusted.vocabulary && adjusted.vocabulary.length > 0) {
        await prisma.vocabularyEntry.createMany({
          data: adjusted.vocabulary.map((v) => ({
            episodeId,
            number: v.number,
            word: v.word,
            translation: v.translation,
            partOfSpeech: v.partOfSpeech,
            pronunciation: v.pronunciation,
            exampleSentence: v.exampleSentence,
            difficulty: v.difficulty,
          })),
        });
      }

      // Use adjusted turns for downstream routing
      turns = adjusted.turns;

      logger.info('Script duration adjusted', { episodeId });
    }

    if (references.length > 0 && verificationMode !== 'showcase') {
      await prisma.episode.update({
        where: { id: episodeId },
        data: { status: 'COMPILING' },
      });
      await invalidateEpisodeCache(episodeId);
      await publishEpisodeStatus(episodeId, { status: 'COMPILING' });

      await addJob(referenceValidationQueue, JobType.VALIDATE_REFERENCES, {
        episodeId,
        userId,
        useAdminCredits,
      }, { jobId: `validate-${episodeId}-${Date.now()}` });

      logger.info('Script verified, routing to reference validation', { episodeId });
    } else {
      // No references — check source to decide whether to pause for review
      const episode = await prisma.episode.findUniqueOrThrow({
        where: { id: episodeId },
        select: { source: true },
      });

      // Free users auto-approve (no script review pause)
      const shouldAutoApprove = genFeatures.autoApproveScript ||
        (episode.source !== 'WEB' && episode.source !== 'IMPORT');

      if (!shouldAutoApprove) {
        // Pause for user review (Pro/BYOK users on WEB/IMPORT)
        await prisma.episode.update({
          where: { id: episodeId },
          data: { status: 'SCRIPT_READY' },
        });
        await invalidateEpisodeCache(episodeId);
        await publishEpisodeStatus(episodeId, { status: 'SCRIPT_READY' });

        await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
          userId,
          type: 'SCRIPT_READY',
          title: 'Script ready for review',
          message: 'Your episode script is ready. Review and approve it to start audio generation.',
          data: { episodeId },
        });

        logger.info('Script verified (no refs), paused at SCRIPT_READY for review', { episodeId });
      } else {
        // Auto-approve for non-WEB/IMPORT sources (no user at browser).
        const svExistingEpisode = await prisma.episode.findUniqueOrThrow({
          where: { id: episodeId },
          select: { ttsProvider: true },
        });
        if (!svExistingEpisode.ttsProvider) {
          const selected = await getAutoModelConfig();
          await prisma.episode.update({
            where: { id: episodeId },
            data: { ttsProvider: selected.model.ttsProvider, ttsModel: selected.model.ttsModel },
          });
        }

        // Assign voices for multi-speaker episodes
        const svEpisode = await prisma.episode.findUniqueOrThrow({
          where: { id: episodeId },
          select: { ttsProvider: true },
        });
        const svProvider = (svEpisode.ttsProvider ?? 'elevenlabs') as TtsProviderId;
        const svSpeakers = discovery.speakers as Array<{ name: string; description?: string }> | null;
        const speakerList = svSpeakers && svSpeakers.length > 0
          ? svSpeakers
          : [...new Set(turns.map((t) => t.speaker))].map((name) => ({ name }));
        await assignVoicesForEpisode(episodeId, speakerList, svProvider);

        // Convert TTS tags before creating segments
        const scriptTurns = turns as Array<{ speaker: string; text: string; direction?: string }>;
        const convertedScriptTurns = svEpisode.ttsProvider
          ? await convertTurnsForProvider(scriptTurns, svProvider, { mode: 'disabled' })
          : scriptTurns;
        await createSegmentsAndQueueAudio(episodeId, convertedScriptTurns);

        await prisma.episode.update({
          where: { id: episodeId },
          data: { status: 'GENERATING_AUDIO' },
        });
        await invalidateEpisodeCache(episodeId);
        await publishEpisodeStatus(episodeId, { status: 'GENERATING_AUDIO' });

        logger.info('Script verified (no refs), auto-approved for audio generation', { episodeId });
      }
    }

    await logPipelineStageComplete(episodeId, 'script-verification');
    await job.updateProgress(100);
    return;
  }

  // Script failed verification
  if (attemptNumber >= MAX_VERIFICATION_ATTEMPTS) {
    const isParseError = verdict.failureType === 'parse_error';
    const userMessage = isParseError
      ? 'We encountered a temporary processing issue while fact-checking your episode. Please try generating again.'
      : "Our fact-checker found issues that couldn't be resolved after 3 attempts. Please try again with a different topic or approach.";

    await markEpisodeFailed(episodeId, {
      failureReason: userMessage,
      technicalError: `Verification failed ${attemptNumber}/${MAX_VERIFICATION_ATTEMPTS}: ${verdict.feedback}`,
    });

    await prisma.pipelineEvent.create({
      data: {
        episodeId,
        stage: 'script-verification',
        type: 'error',
        message: `Verification failed after ${attemptNumber} attempts. Score: ${verdict.score}. ${verdict.feedback}`,
        metadata: {
          attemptNumber,
          score: verdict.score,
          totalClaims: verdict.totalClaims,
          unsupported: verdict.unsupportedClaims.length,
          ...(isParseError ? { failureType: 'parse_error' } : {}),
        },
      },
    }).catch(err => logger.error('Failed to write PipelineEvent', {
      episodeId,
      error: err instanceof Error ? err.message : String(err),
    }));

    await prisma.script.update({
      where: { episodeId },
      data: {
        verificationAttempts: attemptNumber,
        verificationFeedback: verdict.feedback,
        verificationClaims: verdict.allClaims as unknown as Prisma.InputJsonValue,
      },
    });

    await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
      userId,
      type: 'EPISODE_FAILED',
      title: 'Episode generation failed',
      message: userMessage,
      data: { episodeId },
    });

    logger.error('Script verification failed after max attempts', {
      episodeId,
      attempts: String(attemptNumber),
      score: String(verdict.score),
    });

    await job.updateProgress(100);
    return;
  }

  // Revision loop: regenerate script with feedback
  await job.updateProgress(60);

  await prisma.script.update({
    where: { episodeId },
    data: {
      verificationAttempts: attemptNumber,
      verificationFeedback: verdict.feedback,
      verificationClaims: verdict.allClaims as unknown as Prisma.InputJsonValue,
    },
  });

  logger.info('Regenerating script with feedback', {
    episodeId,
    attempt: String(attemptNumber),
    feedback: verdict.feedback.substring(0, 200),
  });

  // --- Build repair context for the revision call ---
  const repairMode = getRepairMode(attemptNumber);
  const bannedRefNumbers = new Set<number>();

  for (const claim of verdict.unreliableSourceClaims) {
    const badCitations = claim.unreliableCitations?.length ? claim.unreliableCitations : (claim.existingCitations ?? []);
    for (const n of badCitations) bannedRefNumbers.add(n);
  }

  await job.updateProgress(65);

  // Web search strategy: off for early retries (fast text-only revision),
  // enabled only on the final retry and only when there are few unresolved claims.
  const isLastRetry = attemptNumber >= MAX_VERIFICATION_ATTEMPTS - 1;
  const fewUnresolved = (verdict.unsupportedClaims.length + verdict.unreliableSourceClaims.length) <= 3;
  const useWebSearchForRevision = isLastRetry && fewUnresolved;

  logger.info('Revision strategy', {
    episodeId,
    repairMode,
    attempt: String(attemptNumber),
    webSearch: String(useWebSearchForRevision),
    unreliable: String(verdict.unreliableSourceClaims.length),
    unsupported: String(verdict.unsupportedClaims.length),
    banned: String(bannedRefNumbers.size),
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
    repairMode,
    bannedRefNumbers: [...bannedRefNumbers],
    apiKeyOverride: providerAiKey?.apiKey,
    model,
    provider,
    webSearchEnabled: useWebSearchForRevision,
    targetLanguage: episodeRecord.language,
    languageMode: null,
  });

  await job.updateProgress(80);

  await logUsage({
    service: provider,
    model: revised.model,
    category: 'script_generation',
    inputTokens: revised.inputTokens,
    outputTokens: revised.outputTokens,
    episodeId,
    userId,
  });

  // Save revised script (increment version)
  await prisma.script.update({
    where: { episodeId },
    data: {
      turns: revised.turns,
      soundCues: revised.soundCues.length > 0 ? revised.soundCues : undefined,
      markdown: revised.markdown,
      version: { increment: 1 },
    },
  });

  // Replace references: use new ones if available, otherwise keep old set
  // but filter out banned (unreliable) refs to break the loop trap.
  if (revised.references.length > 0) {
    await prisma.reference.deleteMany({ where: { episodeId } });
    await prisma.reference.createMany({
      data: revised.references.map((ref) => ({
        episodeId,
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
  } else if (bannedRefNumbers.size > 0) {
    // Filter banned refs from the kept set to avoid re-verifying the same bad sources
    const cleanedRefs = generatedRefs.filter((r) => !bannedRefNumbers.has(r.number));
    if (cleanedRefs.length > 0) {
      // Clean stale citation markers from turns that reference removed refs
      const allRefNumbers = generatedRefs.map((r) => r.number);
      const renumberMap = buildRenumberMap(allRefNumbers, bannedRefNumbers);
      const cleanedTurns = cleanAndRenumberCitations(
        revised.turns as Array<{ speaker: string; text: string; direction?: string }>,
        bannedRefNumbers,
        renumberMap,
      );

      // Renumber the kept refs to match the cleaned citations
      const renumberedRefs = cleanedRefs.map((ref) => ({
        ...ref,
        number: renumberMap.get(ref.number) ?? ref.number,
      }));

      await prisma.reference.deleteMany({ where: { episodeId } });
      await prisma.reference.createMany({
        data: renumberedRefs.map((ref) => ({
          episodeId,
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

      // Update saved turns with cleaned citations
      await prisma.script.update({
        where: { episodeId },
        data: { turns: cleanedTurns },
      });

      logger.info('Filtered banned refs and cleaned citations', {
        episodeId,
        removed: String(bannedRefNumbers.size),
        remaining: String(cleanedRefs.length),
      });
    } else {
      logger.warn('All refs banned and revision produced 0 — keeping previous set', { episodeId });
    }
  } else {
    logger.warn('Revision produced 0 references, keeping previous set', { episodeId });
  }

  // Sync vocabulary entries with the revised script
  await prisma.vocabularyEntry.deleteMany({ where: { episodeId } });
  if (revised.vocabulary && revised.vocabulary.length > 0) {
    await prisma.vocabularyEntry.createMany({
      data: revised.vocabulary.map((v) => ({
        episodeId,
        number: v.number,
        word: v.word,
        translation: v.translation,
        partOfSpeech: v.partOfSpeech,
        pronunciation: v.pronunciation,
        exampleSentence: v.exampleSentence,
        difficulty: v.difficulty,
      })),
    });
  }

  await job.updateProgress(90);

  // Re-queue for another verification pass
  await addJob(scriptVerificationQueue, JobType.VERIFY_SCRIPT, {
    episodeId,
    userId,
    discoveryId,
    useAdminCredits,
  }, { jobId: `verify-${episodeId}-${attemptNumber + 1}-${Date.now()}` });

  logger.info('Script revised and re-queued for verification', {
    episodeId,
    attempt: String(attemptNumber),
    newReferences: String(revised.references.length),
  });

  await job.updateProgress(100);
}
