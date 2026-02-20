import { Job } from 'bullmq';
import {
  ValidateReferencesPayload,
  addJob,
  JobType,
  notificationQueue,
} from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { markPodcastFailed } from '@/lib/pipeline-resume';
import {
  verifyUrl,
  verifyDoi,
  searchTitle,
  aiEvaluateReferences,
  computeVerificationVerdict,
  assessSourceQuality,
  type ReferenceInput,
  type VerificationCheck,
  type VerificationVerdict,
} from '@/lib/reference-validator';
import {
  buildRenumberMap,
  cleanAndRenumberCitations,
  cleanAndRenumberMarkdown,
} from '@/lib/script-updater';
import { createSegmentsAndQueueAudio } from '@/lib/segment-creator';
import { getAiKey } from '@/lib/byok';
import { getFreeTierConfig } from '@/lib/free-tier-config';
import { getAiProviderMeta, type AiProviderId } from '@/lib/providers/ai-registry';
import { logger } from '@/lib/logger';

const MAX_CONCURRENT = 5;

async function runWithConcurrencyLimit<T>(
  tasks: Array<() => Promise<T>>,
  limit: number
): Promise<T[]> {
  const results: T[] = [];
  let index = 0;

  async function runNext(): Promise<void> {
    while (index < tasks.length) {
      const currentIndex = index++;
      results[currentIndex] = await tasks[currentIndex]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => runNext());
  await Promise.all(workers);
  return results;
}

export async function processReferenceValidation(
  job: Job<ValidateReferencesPayload>
): Promise<void> {
  const { podcastId, userId } = job.data;

  logger.info('Starting reference validation', { podcastId });
  await job.updateProgress(5);

  const aiKey = await getAiKey(userId);

  // Load references and script
  const [references, script, podcast] = await Promise.all([
    prisma.reference.findMany({
      where: { podcastId },
      orderBy: { number: 'asc' },
    }),
    prisma.script.findUnique({
      where: { podcastId },
    }),
    prisma.podcast.findUnique({
      where: { id: podcastId },
      select: { topic: true, aiModel: true },
    }),
  ]);

  // Model priority: user's choice > provider default > free tier admin config
  let model = podcast?.aiModel ?? undefined;
  if (!model && aiKey) {
    model = getAiProviderMeta(aiKey.provider as AiProviderId).defaultModel;
  }
  if (!model) {
    const config = await getFreeTierConfig();
    model = config.aiAllocations.length > 0
      ? config.aiAllocations[0].model
      : config.aiModel;
  }

  if (!script) {
    throw new Error(`Script not found for podcast ${podcastId}`);
  }

  if (references.length === 0) {
    logger.info('No references to validate, proceeding to audio generation', { podcastId });
    await createSegmentsAndQueueAudio(
      podcastId,
      script.turns as Array<{ speaker: string; text: string }>
    );
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

  // Source quality pre-filter: reject blocked domains before running verification layers
  const rejectedRefIds = new Set<string>();
  for (const ref of refInputs) {
    const quality = assessSourceQuality(ref);
    if (!quality.accepted) {
      rejectedRefIds.add(ref.id);
      logger.info('Reference rejected by source quality filter', {
        podcastId,
        refNumber: String(ref.number),
        reason: quality.reason,
      });
    }
  }

  // Filter to only refs that passed the quality check
  const acceptedRefInputs = refInputs.filter((r) => !rejectedRefIds.has(r.id));

  // Layers 1-3: run in parallel per reference, with concurrency limit
  const allChecks = new Map<string, VerificationCheck[]>();

  const layer1to3Tasks = acceptedRefInputs.map((ref) => async () => {
    const [urlCheck, doiCheck, titleCheck] = await Promise.all([
      verifyUrl(ref),
      verifyDoi(ref),
      searchTitle(ref),
    ]);
    return { id: ref.id, checks: [urlCheck, doiCheck, titleCheck] };
  });

  await job.updateProgress(15);

  let externalChecksResults: Array<{ id: string; checks: VerificationCheck[] }>;
  try {
    externalChecksResults = await runWithConcurrencyLimit(layer1to3Tasks, MAX_CONCURRENT);
  } catch (error) {
    // If all external APIs are down, proceed with empty checks
    logger.warn('External verification APIs failed, proceeding with AI-only', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
    externalChecksResults = refInputs.map((ref) => ({ id: ref.id, checks: [] }));
  }

  for (const result of externalChecksResults) {
    allChecks.set(result.id, result.checks);
  }

  await job.updateProgress(50);

  // Layer 4: AI evaluation (single batch call, only accepted refs)
  // Skip in claude-code mode — CLI doesn't support web search tool and times out
  let aiResults: Map<string, VerificationCheck>;
  if (process.env.AI_PROVIDER === 'claude-code' && !aiKey?.apiKey) {
    logger.info('Skipping AI reference evaluation in claude-code mode', { podcastId });
    aiResults = new Map();
  } else {
    try {
      aiResults = await aiEvaluateReferences(acceptedRefInputs, allChecks, podcast?.topic || '', aiKey?.apiKey, model);
    } catch (error) {
      logger.warn('AI evaluation failed, using external checks only', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      aiResults = new Map();
    }
  }

  // Merge AI results into allChecks
  for (const [refId, aiCheck] of aiResults) {
    const existing = allChecks.get(refId) || [];
    existing.push(aiCheck);
    allChecks.set(refId, existing);
  }

  await job.updateProgress(55);

  // Compute verdicts
  const verdicts = new Map<string, VerificationVerdict>();
  const removedNumbers = new Set<number>();

  for (const ref of references) {
    // References rejected by source quality filter are immediately REMOVED
    if (rejectedRefIds.has(ref.id)) {
      verdicts.set(ref.id, { status: 'REMOVED', confidence: 0 });
      removedNumbers.add(ref.number);
      continue;
    }

    const checks = allChecks.get(ref.id) || [];
    const verdict = computeVerificationVerdict(checks);

    verdicts.set(ref.id, verdict);

    if (verdict.status === 'REMOVED' || verdict.status === 'FAILED') {
      removedNumbers.add(ref.number);
    }
  }

  await job.updateProgress(65);

  // Check if ALL references failed
  const allFailed = references.every((ref) => {
    const v = verdicts.get(ref.id);
    return v?.status === 'REMOVED' || v?.status === 'FAILED';
  });

  if (allFailed) {
    await markPodcastFailed(podcastId);

    await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
      userId,
      type: 'PODCAST_READY',
      title: 'Podcast generation failed',
      message: 'All references could not be verified. Please try again with a different topic.',
      data: { podcastId },
    });

    logger.error('All references failed verification', { podcastId });
    await job.updateProgress(100);
    return;
  }

  // Update Reference records
  for (const ref of references) {
    const verdict = verdicts.get(ref.id);
    if (!verdict) continue;

    const checks = allChecks.get(ref.id) || [];
    const verificationDetails = {
      checks: checks.map((c) => ({
        layer: c.layer,
        passed: c.passed,
        confidence: c.confidence,
        detail: c.detail,
      })),
      verifiedAt: new Date().toISOString(),
    };

    if (verdict.status === 'REPLACED' && verdict.replacement) {
      await prisma.reference.update({
        where: { id: ref.id },
        data: {
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
      await prisma.reference.update({
        where: { id: ref.id },
        data: {
          verificationStatus: verdict.status === 'REMOVED' ? 'REMOVED' : 'FAILED',
          verificationDetails,
        },
      });
    } else {
      await prisma.reference.update({
        where: { id: ref.id },
        data: {
          verificationStatus: 'VERIFIED',
          verificationDetails,
        },
      });
    }
  }

  await job.updateProgress(70);

  // Clean script if any references were removed
  let turns = script.turns as Array<{ speaker: string; text: string }>;
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

  await job.updateProgress(80);

  // Check source to decide whether to pause for review
  const podcastRecord = await prisma.podcast.findUniqueOrThrow({
    where: { id: podcastId },
    select: { source: true },
  });

  if (podcastRecord.source === 'WEB' || podcastRecord.source === 'IMPORT') {
    // Pause for user review
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
    // Auto-approve for TWITTER/API sources
    await createSegmentsAndQueueAudio(podcastId, turns);

    await prisma.podcast.update({
      where: { id: podcastId },
      data: { status: 'GENERATING_AUDIO' },
    });

    logger.info('References validated, auto-approved for audio generation', { podcastId });
  }

  await job.updateProgress(100);

  const verifiedCount = [...verdicts.values()].filter((v) => v.status === 'VERIFIED').length;
  const replacedCount = [...verdicts.values()].filter((v) => v.status === 'REPLACED').length;
  const removedCount = removedNumbers.size;

  logger.info('Reference validation complete', {
    podcastId,
    verified: String(verifiedCount),
    replaced: String(replacedCount),
    removed: String(removedCount),
  });
}
