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
import { getAiKey, hasByokKey } from '@/lib/byok';
import { getTierFeatures } from '@/lib/tier-features';
import { selectFreeTierProviders } from '@/lib/free-tier-provider-selector';
import { resolveAiModelAndProvider } from '@/lib/providers/ai-registry';
import { logger } from '@/lib/logger';

export async function processReferenceValidation(
  job: Job<ValidateReferencesPayload>
): Promise<void> {
  const { podcastId, userId, useAdminCredits } = job.data;

  logger.info('Starting reference validation', { podcastId });
  await job.updateProgress(5);

  const aiKey = useAdminCredits ? null : await getAiKey(userId);

  // Load references and script
  const [references, script, podcast, userPlanRecord] = await Promise.all([
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
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { plan: true } }),
  ]);

  // Model + provider resolved together — prevents sending e.g. gpt-5-mini to Anthropic
  const { model } = await resolveAiModelAndProvider({
    podcastAiModel: podcast?.aiModel,
    aiKey,
    plan: userPlanRecord.plan as 'FREE' | 'PRO',
  });

  if (!script) {
    throw new Error(`Script not found for podcast ${podcastId}`);
  }

  if (references.length === 0) {
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

  const scriptTurns = script.turns as Array<{ speaker: string; text: string; direction?: string }>;

  await job.updateProgress(15);

  // Run domain-aware verification pipeline
  const { results: verificationResults, rejectedRefIds } = await runReferenceVerification(
    refInputs,
    scriptTurns,
    podcast?.topic || '',
    aiKey?.apiKey,
    model
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

  // Update Reference records
  for (const ref of references) {
    if (rejectedRefIds.has(ref.id)) {
      await prisma.reference.update({
        where: { id: ref.id },
        data: {
          verificationStatus: 'REMOVED',
          verificationDetails: { checks: [], verifiedAt: new Date().toISOString() },
        },
      });
      continue;
    }

    const result = verificationResults.get(ref.id);
    if (!result) continue;

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
      await prisma.reference.update({
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
      await prisma.reference.update({
        where: { id: ref.id },
        data: {
          contentDomain: result.domain,
          verificationStatus: verdict.status === 'REMOVED' ? 'REMOVED' : 'FAILED',
          verificationDetails,
        },
      });
    } else {
      await prisma.reference.update({
        where: { id: ref.id },
        data: {
          contentDomain: result.domain,
          verificationStatus: 'VERIFIED',
          verificationDetails,
        },
      });
    }
  }

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

  await job.updateProgress(80);

  // Check source + tier to decide whether to pause for review
  const [podcastRecord, isByok, userRecord] = await Promise.all([
    prisma.podcast.findUniqueOrThrow({
      where: { id: podcastId },
      select: { source: true },
    }),
    useAdminCredits ? Promise.resolve(true) : hasByokKey(userId),
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { plan: true, role: true },
    }),
  ]);
  const tierFeatures = getTierFeatures(userRecord.plan as 'FREE' | 'PRO', isByok, userRecord.role);

  // Non-WEB/IMPORT sources always auto-approve; for WEB/IMPORT, check tier
  const isWebOrImport = podcastRecord.source === 'WEB' || podcastRecord.source === 'IMPORT';
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

    await createSegmentsAndQueueAudio(podcastId, turns);

    await prisma.podcast.update({
      where: { id: podcastId },
      data: { status: 'GENERATING_AUDIO' },
    });

    logger.info('References validated, auto-approved for audio generation', { podcastId });
  }

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
