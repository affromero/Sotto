import { Job } from 'bullmq';
import {
  ValidateReferencesPayload,
  addJob,
  JobType,
  notificationQueue,
  referenceValidationQueue,
} from '@/lib/queue';
import { Prisma } from '@prisma/client';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { invalidatePodcastCache, publishPodcastStatus } from '@/lib/redis';
import { type ReferenceInput } from '@/lib/reference-validator';
import { runReferenceVerification, buildReferenceRetryFeedback, mergeVerifiedReferences } from '@/lib/reference-verification';
import { generateScriptWithFeedback } from '@/lib/script-generator';
import {
  buildRenumberMap,
  cleanAndRenumberCitations,
  cleanAndRenumberMarkdown,
} from '@/lib/script-updater';
import { createSegmentsAndQueueAudio } from '@/lib/segment-creator';
import { convertTurnsForProvider } from '@/lib/tts-tag-converter';
import { MIN_REFERENCE_COUNTS } from '@/lib/script-verifier';
import { getAiKey, getByokKey, hasByokKey } from '@/lib/byok';
import { getTierFeatures } from '@/lib/tier-features';
import { selectFreeTierProviders } from '@/lib/free-tier-provider-selector';
import { assignVoicesForPodcast } from '@/lib/voice-assigner';
import { resolveAiModelAndProvider } from '@/lib/providers/ai-registry';
import type { TtsProviderId } from '@/lib/providers/tts-registry';
import { logger } from '@/lib/logger';
import { logPipelineStageComplete } from '@/lib/pipeline-events';
import { extractDiscoveryFigures } from '@/lib/discovery-figure-extractor';

const MAX_REF_RETRY_ATTEMPTS: Record<string, number> = {
  deep_dive: 3,
  standard: 2,
  quick_overview: 1,
  eli5: 1,
};

export async function processReferenceValidation(
  job: Job<ValidateReferencesPayload>
): Promise<void> {
  const { podcastId, userId, useAdminCredits, referenceRetryAttempt, previousVerifiedCount, previouslyVerifiedRefIds } = job.data;
  const attempt = referenceRetryAttempt ?? 0;

  logger.info('Starting reference validation', { podcastId, attempt: String(attempt) });
  await job.updateProgress(5);

  const aiKey = useAdminCredits ? null : await getAiKey(userId);

  // Load references and script
  const [references, script, podcast, userPlanRecord, discovery] = await Promise.all([
    prisma.reference.findMany({
      where: { podcastId },
      orderBy: { number: 'asc' },
    }),
    prisma.script.findUnique({
      where: { podcastId },
    }),
    prisma.podcast.findUnique({
      where: { id: podcastId },
      select: { topic: true, aiModel: true, source: true, verificationMode: true },
    }),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { plan: true } }),
    prisma.discovery.findUnique({
      where: { podcastId },
      select: {
        depth: true,
        topic: true,
        audienceLevel: true,
        audience: true,
        focusAreas: true,
        tone: true,
        durationTarget: true,
        sourceContent: true,
        sourceMetadata: true,
        speakers: true,
      },
    }),
  ]);

  // Model + provider resolved together — prevents sending e.g. gpt-5-mini to Anthropic
  const { model, provider } = await resolveAiModelAndProvider({
    podcastAiModel: podcast?.aiModel,
    aiKey,
    plan: userPlanRecord.plan as 'FREE' | 'PRO',
  });
  const verificationModel = model;

  if (!script) {
    throw new Error(`Script not found for podcast ${podcastId}`);
  }

  // Compute minimum reference requirement for this podcast
  const depth = discovery?.depth || 'standard';
  const isShowcase = podcast?.verificationMode === 'showcase';
  const effectiveDepth = podcast?.verificationMode === 'relaxed' ? 'eli5' : depth;
  const requiredRefCount = MIN_REFERENCE_COUNTS[effectiveDepth] ?? 5;

  if (references.length === 0) {
    // Gate: pause as draft if references are required but none exist
    if (!isShowcase && requiredRefCount > 0) {
      logger.warn('No references found — pausing at SCRIPT_READY for user action', {
        podcastId,
        required: String(requiredRefCount),
        depth,
      });

      await prisma.podcast.update({
        where: { id: podcastId },
        data: { status: 'SCRIPT_READY', lowReferences: true },
      });
      await invalidatePodcastCache(podcastId);
      await publishPodcastStatus(podcastId, { status: 'SCRIPT_READY' });

      await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
        userId,
        type: 'SCRIPT_READY',
        title: 'Script needs references',
        message: 'Your podcast doesn\'t have enough verified references. Add source URLs, explore a different angle, or delete it.',
        data: { podcastId, insufficientRefs: true, verified: 0, required: requiredRefCount },
      });
      return;
    }

    logger.info('No references to validate, proceeding to audio generation', { podcastId });
    // Select TTS provider at auto-approve time (deferred from pipeline start)
    const isByokEarly = useAdminCredits ? true : await hasByokKey(userId);
    if (!isByokEarly) {
      const selected = await selectFreeTierProviders(userId);
      await prisma.podcast.update({
        where: { id: podcastId },
        data: { ttsProvider: selected.ttsProvider, ttsModel: selected.ttsModel },
      });
    }

    // Assign voices for multi-speaker podcasts
    const earlyTurns = script.turns as Array<{ speaker: string; text: string }>;
    const earlyPodcast = await prisma.podcast.findUniqueOrThrow({
      where: { id: podcastId },
      select: { ttsProvider: true },
    });
    const earlyProvider = (earlyPodcast.ttsProvider ?? 'elevenlabs') as TtsProviderId;
    const earlySpeakers = [...new Set(earlyTurns.map((t) => t.speaker))].map((name) => ({ name }));
    const earlyTtsKey = isByokEarly ? ((await getByokKey(userId, earlyProvider)) ?? undefined) : undefined;
    await assignVoicesForPodcast(podcastId, earlySpeakers, earlyProvider, earlyTtsKey);

    // Convert TTS tags before creating segments
    const convertedEarlyTurns = earlyPodcast.ttsProvider
      ? await convertTurnsForProvider(earlyTurns, earlyProvider, podcastId)
      : earlyTurns;
    await createSegmentsAndQueueAudio(podcastId, convertedEarlyTurns);
    await job.updateProgress(100);
    return;
  }

  const refInputs: ReferenceInput[] = references.map((r) => ({
    id: r.id,
    number: r.number,
    title: r.title,
    authors: r.authors,
    year: r.year,
    url: r.url,
    doi: r.doi,
    type: r.type,
  }));

  // Filter out previously verified refs on retry
  const previouslyVerifiedSet = new Set(previouslyVerifiedRefIds ?? []);
  const refsToVerify = refInputs.filter((r) => !previouslyVerifiedSet.has(r.id));
  const skippedVerifiedCount = refInputs.length - refsToVerify.length;

  if (skippedVerifiedCount > 0) {
    logger.info('Skipping re-verification for previously verified refs', {
      podcastId,
      skipped: String(skippedVerifiedCount),
      verifying: String(refsToVerify.length),
    });
  }

  const scriptTurns = script.turns as Array<{ speaker: string; text: string; direction?: string }>;

  // Write initial progress snapshot
  await prisma.podcast.update({
    where: { id: podcastId },
    data: {
      verificationProgress: {
        total: refInputs.length,
        checked: skippedVerifiedCount,
        verified: skippedVerifiedCount,
        replaced: 0,
        removed: 0,
        rejected: 0,
        attempt: attempt + 1,
        maxAttempts: MAX_REF_RETRY_ATTEMPTS[effectiveDepth] ?? 1,
        phase: 'checking',
      },
    },
  });

  await job.updateProgress(15);

  // Run domain-aware verification pipeline (only on refs that need verification)
  const { results: verificationResults, rejectedRefIds, claimContexts } = await runReferenceVerification(
    refsToVerify,
    scriptTurns,
    podcast?.topic || '',
    aiKey?.apiKey,
    verificationModel,
    provider,
    requiredRefCount
  );

  await job.updateProgress(55);

  // Compute final verdicts (rejected refs → REMOVED)
  const removedNumbers = new Set<number>();

  for (const ref of references) {
    if (rejectedRefIds.has(ref.id)) {
      removedNumbers.add(ref.number);
    } else {
      const result = verificationResults.get(ref.id);
      if (result && (result.verdict.status === 'REMOVED' || result.verdict.status === 'FAILED')) {
        removedNumbers.add(ref.number);
      }
    }
  }

  await job.updateProgress(65);

  // Update Reference records — independent rows, safe to parallelize
  const refUpdates = references.map((ref) => {
    // Skip DB update for previously verified refs — already written in prior attempt
    if (previouslyVerifiedSet.has(ref.id)) return null;

    if (rejectedRefIds.has(ref.id)) {
      return prisma.reference.update({
        where: { id: ref.id },
        data: {
          verificationStatus: 'REMOVED',
          verificationDetails: { checks: [], verifiedAt: new Date().toISOString() },
        },
      });
    }

    const result = verificationResults.get(ref.id);
    if (!result) return null;

    const verificationDetails = {
      checks: result.checks.map((c) => ({
        layer: c.layer,
        passed: c.passed,
        confidence: c.confidence,
        detail: c.detail,
      })),
      posterior: result.score,
      logOddsContributions: result.logOddsContributions,
      verifiedAt: new Date().toISOString(),
    };

    const { verdict } = result;

    if (verdict.status === 'REPLACED' && verdict.replacement) {
      return prisma.reference.update({
        where: { id: ref.id },
        data: {
          contentDomain: result.domain,
          verificationStatus: 'REPLACED',
          verificationDetails,
          originalTitle: ref.title,
          title: verdict.replacement.title || ref.title,
          authors: verdict.replacement.authors || ref.authors,
          year: verdict.replacement.year ?? ref.year,
          url: verdict.replacement.url ?? ref.url,
          doi: verdict.replacement.doi ?? ref.doi,
          publisher: verdict.replacement.publisher ?? ref.publisher,
        },
      });
    } else if (verdict.status === 'REMOVED' || verdict.status === 'FAILED') {
      return prisma.reference.update({
        where: { id: ref.id },
        data: {
          contentDomain: result.domain,
          verificationStatus: verdict.status === 'REMOVED' ? 'REMOVED' : 'FAILED',
          verificationDetails,
        },
      });
    } else {
      return prisma.reference.update({
        where: { id: ref.id },
        data: {
          contentDomain: result.domain,
          verificationStatus: 'VERIFIED',
          verificationDetails,
        },
      });
    }
  });

  await Promise.all(refUpdates.filter(Boolean));

  await job.updateProgress(70);

  // Extract figures/tables from verified reference URLs and merge into sourceMetadata
  const verifiedRefs = references.filter(
    (ref) => ref.url && !rejectedRefIds.has(ref.id) && verificationResults.get(ref.id)?.verdict.status !== 'REMOVED'
  );
  if (verifiedRefs.length > 0) {
    await extractDiscoveryFigures(podcastId, verifiedRefs);
  }

  // Clean script if any references were removed
  let turns = scriptTurns;
  let markdown = script.markdown;

  if (removedNumbers.size > 0) {
    const allNumbers = references.map((r) => r.number);
    const renumberMap = buildRenumberMap(allNumbers, removedNumbers);

    turns = cleanAndRenumberCitations(turns, removedNumbers, renumberMap);
    markdown = cleanAndRenumberMarkdown(markdown, removedNumbers, renumberMap);

    // Update script
    await prisma.script.update({
      where: { podcastId },
      data: { turns, markdown },
    });

    // Delete removed references FIRST (before renumbering to avoid unique constraint conflicts)
    await prisma.reference.deleteMany({
      where: {
        podcastId,
        number: { in: [...removedNumbers] },
      },
    });

    // Renumber remaining references in DB
    for (const [oldNum, newNum] of renumberMap) {
      if (oldNum !== newNum) {
        const ref = references.find((r) => r.number === oldNum);
        if (ref) {
          await prisma.reference.update({
            where: { id: ref.id },
            data: { number: newNum },
          });
        }
      }
    }

    logger.info('Script cleaned and references renumbered', {
      podcastId,
      removed: String(removedNumbers.size),
      renumbered: String(renumberMap.size),
    });
  }

  await job.updateProgress(75);

  // Gate: pause as draft if remaining references are below minimum for depth
  const remainingRefCount = references.length - removedNumbers.size;
  const verifiedCount = [...verificationResults.values()].filter(
    (r) => r.verdict.status === 'VERIFIED' || r.verdict.status === 'REPLACED'
  ).length + skippedVerifiedCount;
  const maxRetries = MAX_REF_RETRY_ATTEMPTS[effectiveDepth] ?? 1;

  if (!isShowcase && remainingRefCount < requiredRefCount) {
    // Early termination: if this attempt verified fewer than last, stop (going backward)
    const goingBackward = previousVerifiedCount !== undefined && verifiedCount < previousVerifiedCount;

    if (attempt < maxRetries && !goingBackward) {
      // --- RETRY PATH: regenerate script with feedback ---
      logger.info('References below minimum — retrying with feedback', {
        podcastId,
        attempt: String(attempt),
        maxRetries: String(maxRetries),
        verified: String(verifiedCount),
        required: String(requiredRefCount),
      });

      // Write progress snapshot (replacing phase)
      await prisma.podcast.update({
        where: { id: podcastId },
        data: {
          verificationProgress: {
            total: references.length,
            checked: references.length,
            verified: verifiedCount,
            replaced: [...verificationResults.values()].filter((r) => r.verdict.status === 'REPLACED').length,
            removed: removedNumbers.size,
            rejected: rejectedRefIds.size,
            attempt: attempt + 1,
            maxAttempts: maxRetries,
            phase: 'replacing',
          },
        },
      });

      // Build feedback for LLM
      const feedback = buildReferenceRetryFeedback({
        references: references.map((r) => ({
          id: r.id,
          number: r.number,
          title: r.title,
          authors: r.authors,
          year: r.year,
          url: r.url,
          doi: r.doi,
          type: r.type,
          publisher: r.publisher,
        })),
        verificationResults,
        rejectedRefIds,
        claimContexts,
        requiredRefCount,
      });

      // Load the current (possibly cleaned) script for regeneration
      const currentScript = await prisma.script.findUnique({ where: { podcastId } });
      const currentRefs = await prisma.reference.findMany({
        where: { podcastId },
        orderBy: { number: 'asc' },
      });

      if (currentScript && discovery) {
        const regenResult = await generateScriptWithFeedback({
          topic: discovery.topic || podcast?.topic || '',
          depth: discovery.depth || 'standard',
          audienceLevel: discovery.audienceLevel || 'intermediate',
          audience: discovery.audience || undefined,
          focusAreas: discovery.focusAreas || [],
          tone: discovery.tone || 'casual',
          durationTarget: discovery.durationTarget || 10,
          sourceContent: discovery.sourceContent || undefined,
          sourceMetadata: discovery.sourceMetadata as Parameters<typeof generateScriptWithFeedback>[0]['sourceMetadata'],
          speakers: discovery.speakers as Array<{ name: string; description: string }> | undefined,
          previousScript: currentScript.turns as Array<{ speaker: string; text: string }>,
          previousReferences: currentRefs.map((r) => ({
            number: r.number,
            title: r.title,
            type: r.type,
            url: r.url,
            authors: r.authors,
            year: r.year,
            publisher: r.publisher,
            doi: r.doi,
          })),
          verificationFeedback: feedback,
          apiKeyOverride: aiKey?.apiKey,
          model: verificationModel,
          provider,
          webSearchEnabled: true,
        });

        // Merge verified refs back into the regenerated output
        const merged = mergeVerifiedReferences({
          previousRefs: currentRefs.map((r) => ({
            id: r.id,
            number: r.number,
            title: r.title,
            authors: r.authors,
            year: r.year,
            url: r.url,
            doi: r.doi,
            type: r.type,
            publisher: r.publisher,
          })),
          previousResults: verificationResults,
          newRefs: regenResult.references.map((r) => ({
            number: r.number,
            title: r.title,
            authors: r.authors,
            year: r.year,
            url: r.url,
            doi: r.doi,
            type: r.type,
            publisher: r.publisher,
          })),
        });

        // Save regenerated script
        await prisma.script.update({
          where: { podcastId },
          data: {
            turns: regenResult.turns,
            markdown: regenResult.markdown,
          },
        });

        // Replace all references with merged set
        await prisma.reference.deleteMany({ where: { podcastId } });
        if (merged.length > 0) {
          await prisma.reference.createMany({
            data: merged.map((r) => ({
              podcastId,
              number: r.number,
              title: r.title,
              authors: r.authors,
              year: r.year,
              url: r.url,
              doi: r.doi,
              type: r.type.toUpperCase() as 'WEB' | 'PAPER' | 'BOOK' | 'ARTICLE' | 'VIDEO' | 'REPORT',
              publisher: r.publisher,
              verificationStatus: r.isVerified ? 'VERIFIED' as const : 'PENDING' as const,
            })),
          });
        }

        // Log pipeline event
        await logPipelineStageComplete(
          podcastId,
          'reference-validation-retry',
          `Attempt ${attempt + 1}: ${verifiedCount} verified, regenerated ${merged.length} refs`
        );

        // Collect verified ref IDs to skip on next pass
        const verifiedRefIds = [...verificationResults.entries()]
          .filter(([, r]) => r.verdict.status === 'VERIFIED' || r.verdict.status === 'REPLACED')
          .map(([id]) => id);
        // Include previously verified refs that were skipped this pass
        const allVerifiedRefIds = [...previouslyVerifiedSet, ...verifiedRefIds];

        // Re-queue for next validation pass
        await addJob(referenceValidationQueue, JobType.VALIDATE_REFERENCES, {
          podcastId,
          userId,
          useAdminCredits,
          referenceRetryAttempt: attempt + 1,
          previousVerifiedCount: verifiedCount,
          previouslyVerifiedRefIds: allVerifiedRefIds,
        });
        return;
      }
    }

    // --- EXHAUSTED RETRIES (or going backward) — fall through to banner ---
    if (goingBackward) {
      logger.warn('Reference retry going backward — stopping', {
        podcastId,
        attempt: String(attempt),
        currentVerified: String(verifiedCount),
        previousVerified: String(previousVerifiedCount),
      });
    }

    logger.warn('References below minimum after validation — pausing at SCRIPT_READY', {
      podcastId,
      remaining: String(remainingRefCount),
      required: String(requiredRefCount),
      depth,
      removed: String(removedNumbers.size),
      retriesExhausted: String(attempt >= maxRetries),
    });

    // Compute failure details for the banner — mutually exclusive categories
    const removedResults = [...verificationResults.values()].filter(
      (r) => r.verdict.status === 'REMOVED'
    );
    let hallucinated = 0;
    let urlNotFound = 0;
    for (const r of removedResults) {
      const aiFailed = r.checks.some((c) => c.layer === 'ai' && !c.passed);
      const urlFailed = r.checks.some((c) => c.layer === 'url' && !c.passed);
      if (aiFailed) {
        hallucinated++;
      } else if (urlFailed) {
        urlNotFound++;
      }
    }
    const replacementFound = [...verificationResults.values()].filter(
      (r) => r.verdict.status === 'REPLACED'
    ).length;

    await prisma.podcast.update({
      where: { id: podcastId },
      data: {
        status: 'SCRIPT_READY',
        lowReferences: true,
        verificationProgress: {
          total: references.length,
          checked: references.length,
          verified: verifiedCount,
          replaced: replacementFound,
          removed: removedNumbers.size,
          rejected: rejectedRefIds.size,
          attempt: attempt + 1,
          maxAttempts: maxRetries,
          phase: 'insufficient',
          failureDetails: {
            hallucinated,
            blockedDomain: rejectedRefIds.size,
            urlNotFound,
            replacementFound,
          },
        },
      },
    });
    await invalidatePodcastCache(podcastId);
    await publishPodcastStatus(podcastId, { status: 'SCRIPT_READY' });

    await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
      userId,
      type: 'SCRIPT_READY',
      title: 'Script needs more references',
      message: `Only ${remainingRefCount} of ${requiredRefCount} required references could be verified. Add source URLs, explore a different angle, or delete it.`,
      data: { podcastId, insufficientRefs: true, verified: remainingRefCount, required: requiredRefCount },
    });
    return;
  }

  // Write complete progress snapshot
  await prisma.podcast.update({
    where: { id: podcastId },
    data: {
      verificationProgress: {
        total: references.length,
        checked: references.length,
        verified: verifiedCount,
        replaced: [...verificationResults.values()].filter((r) => r.verdict.status === 'REPLACED').length,
        removed: removedNumbers.size,
        rejected: rejectedRefIds.size,
        attempt: attempt + 1,
        maxAttempts: MAX_REF_RETRY_ATTEMPTS[effectiveDepth] ?? 1,
        phase: 'complete',
      },
    },
  });

  await job.updateProgress(80);

  // Check source + tier to decide whether to pause for review
  const [isByok, userRecord] = await Promise.all([
    useAdminCredits ? Promise.resolve(true) : hasByokKey(userId),
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { plan: true, role: true },
    }),
  ]);
  const tierFeatures = getTierFeatures(userRecord.plan as 'FREE' | 'PRO', isByok, userRecord.role);

  // Non-WEB/IMPORT sources always auto-approve; for WEB/IMPORT, check tier
  const isWebOrImport = podcast?.source === 'WEB' || podcast?.source === 'IMPORT';
  const shouldAutoApprove = tierFeatures.autoApproveScript || !isWebOrImport;

  if (!shouldAutoApprove) {
    // Pause for user review (Pro users get script review)
    await prisma.podcast.update({
      where: { id: podcastId },
      data: { status: 'SCRIPT_READY', verificationProgress: Prisma.DbNull },
    });
    await invalidatePodcastCache(podcastId);
    await publishPodcastStatus(podcastId, { status: 'SCRIPT_READY' });

    await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
      userId,
      type: 'SCRIPT_READY',
      title: 'Script ready for review',
      message: 'Your podcast script is ready. Review and approve it to start audio generation.',
      data: { podcastId },
    });

    logger.info('References validated, paused at SCRIPT_READY for review', { podcastId });
  } else {
    // Auto-approve for TWITTER/API sources or Free users
    // Select TTS provider at auto-approve time (deferred from pipeline start)
    if (!isByok) {
      const selected = await selectFreeTierProviders(userId);
      await prisma.podcast.update({
        where: { id: podcastId },
        data: { ttsProvider: selected.ttsProvider, ttsModel: selected.ttsModel },
      });
    }
    // BYOK: leave null — worker's resolveTtsProvider() picks best available

    // Assign voices for multi-speaker podcasts
    const latePodcast = await prisma.podcast.findUniqueOrThrow({
      where: { id: podcastId },
      select: { ttsProvider: true },
    });
    const lateProvider = (latePodcast.ttsProvider ?? 'elevenlabs') as TtsProviderId;
    const lateSpeakers = [...new Set(turns.map((t) => t.speaker))].map((name) => ({ name }));
    const lateTtsKey = isByok ? ((await getByokKey(userId, lateProvider)) ?? undefined) : undefined;
    await assignVoicesForPodcast(podcastId, lateSpeakers, lateProvider, lateTtsKey);

    // Convert TTS tags before creating segments
    const convertedTurns = latePodcast.ttsProvider
      ? await convertTurnsForProvider(turns, lateProvider, podcastId)
      : turns;
    await createSegmentsAndQueueAudio(podcastId, convertedTurns);

    await prisma.podcast.update({
      where: { id: podcastId },
      data: { status: 'GENERATING_AUDIO', verificationProgress: Prisma.DbNull },
    });
    await invalidatePodcastCache(podcastId);
    await publishPodcastStatus(podcastId, { status: 'GENERATING_AUDIO' });

    logger.info('References validated, auto-approved for audio generation', { podcastId });
  }

  await logPipelineStageComplete(podcastId, 'reference-validation');
  await job.updateProgress(100);

  const replacedCount = [...verificationResults.values()].filter(
    (r) => r.verdict.status === 'REPLACED'
  ).length;
  const removedCount = removedNumbers.size;

  logger.info('Reference validation complete', {
    podcastId,
    verified: String(verifiedCount),
    replaced: String(replacedCount),
    removed: String(removedCount),
  });
}
