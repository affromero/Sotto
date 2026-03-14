import { Job } from 'bullmq';
import {
  ValidateReferencesPayload,
  addJob,
  JobType,
  notificationQueue,
} from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { type ReferenceInput } from '@/lib/reference-validator';
import { runReferenceVerification } from '@/lib/reference-verification';
import {
  buildRenumberMap,
  cleanAndRenumberCitations,
  cleanAndRenumberMarkdown,
} from '@/lib/script-updater';
import { createSegmentsAndQueueAudio } from '@/lib/segment-creator';
import { convertTurnsForProvider } from '@/lib/tts-tag-converter';
import { markPodcastFailed } from '@/lib/pipeline-resume';
import { MIN_REFERENCE_COUNTS } from '@/lib/script-verifier';
import { getAiKey, getByokKey, hasByokKey } from '@/lib/byok';
import { getTierFeatures } from '@/lib/tier-features';
import { selectFreeTierProviders } from '@/lib/free-tier-provider-selector';
import { assignVoicesForPodcast } from '@/lib/voice-assigner';
import { resolveAiModelAndProvider, getCheapestModelForProvider, type AiProviderId } from '@/lib/providers/ai-registry';
import type { TtsProviderId } from '@/lib/providers/tts-registry';
import { logger } from '@/lib/logger';
import { logPipelineStageComplete } from '@/lib/pipeline-events';

export async function processReferenceValidation(
  job: Job<ValidateReferencesPayload>
): Promise<void> {
  const { podcastId, userId, useAdminCredits } = job.data;

  logger.info('Starting reference validation', { podcastId });
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
      select: { depth: true },
    }),
  ]);

  // Model + provider resolved together — prevents sending e.g. gpt-5-mini to Anthropic
  const { model, provider } = await resolveAiModelAndProvider({
    podcastAiModel: podcast?.aiModel,
    aiKey,
    plan: userPlanRecord.plan as 'FREE' | 'PRO',
  });
  const verificationModel = getCheapestModelForProvider(provider as AiProviderId) ?? model;

  if (!script) {
    throw new Error(`Script not found for podcast ${podcastId}`);
  }

  // Compute minimum reference requirement for this podcast
  const depth = discovery?.depth || 'standard';
  const isShowcase = podcast?.verificationMode === 'showcase';
  const effectiveDepth = podcast?.verificationMode === 'relaxed' ? 'eli5' : depth;
  const requiredRefCount = MIN_REFERENCE_COUNTS[effectiveDepth] ?? 5;

  if (references.length === 0) {
    // Gate: fail if references are required but none exist
    if (!isShowcase && requiredRefCount > 0) {
      logger.error('No references found — minimum required', {
        podcastId,
        required: String(requiredRefCount),
        depth,
      });

      await markPodcastFailed(podcastId,
        `No references could be found — ${requiredRefCount} required for ${depth} depth. The podcast's factual claims could not be adequately sourced.`
      );

      await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
        userId,
        type: 'PODCAST_FAILED',
        title: 'Generation failed',
        message: 'Not enough references could be verified. Try again with a more specific topic or provide source URLs.',
        data: { podcastId },
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

  const scriptTurns = script.turns as Array<{ speaker: string; text: string; direction?: string }>;

  await job.updateProgress(15);

  // Run domain-aware verification pipeline
  const { results: verificationResults, rejectedRefIds } = await runReferenceVerification(
    refInputs,
    scriptTurns,
    podcast?.topic || '',
    aiKey?.apiKey,
    verificationModel,
    provider
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

  // Gate: fail if remaining references are below minimum for depth
  const remainingRefCount = references.length - removedNumbers.size;
  if (!isShowcase && remainingRefCount < requiredRefCount) {
    logger.error('References below minimum after validation', {
      podcastId,
      remaining: String(remainingRefCount),
      required: String(requiredRefCount),
      depth,
      removed: String(removedNumbers.size),
    });

    await markPodcastFailed(podcastId,
      `Only ${remainingRefCount} reference(s) could be verified — ${requiredRefCount} required for ${depth} depth. The podcast's factual claims could not be adequately sourced.`
    );

    await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
      userId,
      type: 'PODCAST_FAILED',
      title: 'Generation failed',
      message: 'Not enough references could be verified. Try again with a more specific topic or provide source URLs.',
      data: { podcastId },
    });
    return;
  }

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
      data: { status: 'SCRIPT_READY' },
    });

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
      data: { status: 'GENERATING_AUDIO' },
    });

    logger.info('References validated, auto-approved for audio generation', { podcastId });
  }

  await logPipelineStageComplete(podcastId, 'reference-validation');
  await job.updateProgress(100);

  const verifiedCount = [...verificationResults.values()].filter(
    (r) => r.verdict.status === 'VERIFIED'
  ).length;
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
