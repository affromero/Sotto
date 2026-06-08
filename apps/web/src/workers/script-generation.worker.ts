import { Job } from 'bullmq';
import { GenerateScriptPayload, addJob, JobType, compileScriptQueue } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { generateScript, generateScriptWithUserFeedback, type SourceMetadata } from '@/lib/script-generator';
import { extractContent } from '@/lib/extractors';
import { logUsage } from '@/lib/usage-logger';
import { getAiKey, hasByokKey } from '@/lib/byok';
import { getCheapestModelForProvider, resolveAiModelAndProvider, type AiProviderId } from '@/lib/providers/ai-registry';
import { detectLanguage } from '@/lib/language-detect';
import { invalidatePodcastCache, publishPodcastStatus } from '@/lib/redis';
import { matchTopicTags, TAG_PARENT_MAP } from '@/lib/topic-tagger';
import { getTierFeatures } from '@/lib/tier-features';
import { logger } from '@/lib/logger';
import { logPipelineStageComplete } from '@/lib/pipeline-events';

export async function processScriptGeneration(job: Job<GenerateScriptPayload>): Promise<void> {
  const { podcastId, userId, discoveryId, useAdminCredits } = job.data;

  logger.info('Generating script', { podcastId });
  await job.updateProgress(10);

  // Idempotency: skip if script already exists
  const existingScript = await prisma.script.findUnique({
    where: { podcastId },
    select: { id: true },
  });

  if (existingScript) {
    logger.info('Script already exists, skipping to compile', { podcastId });

    await prisma.podcast.update({
      where: { id: podcastId },
      data: { status: 'COMPILING' },
    });
    await invalidatePodcastCache(podcastId);
    await publishPodcastStatus(podcastId, { status: 'COMPILING' });

    await addJob(compileScriptQueue, JobType.COMPILE_SCRIPT, {
      podcastId,
      userId,
    }, { jobId: `compile-${podcastId}-${Date.now()}` });

    await job.updateProgress(100);
    return;
  }

  const [hasTts, user, podcast, discovery] = await Promise.all([
    useAdminCredits ? Promise.resolve(true) : hasByokKey(userId),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { plan: true, role: true } }),
    prisma.podcast.findUniqueOrThrow({ where: { id: podcastId }, select: { aiModel: true, verificationMode: true, source: true, language: true } }),
    prisma.discovery.findUniqueOrThrow({ where: { id: discoveryId } }),
  ]);

  const tierFeatures = getTierFeatures(user.plan as 'FREE' | 'PRO', hasTts, user.role);

  const aiKey = useAdminCredits || podcast.aiModel ? null : await getAiKey(userId);
  if (!podcast.aiModel && !aiKey) {
    throw new Error('AI model is required for script generation when no AI key is configured.');
  }

  // Model + provider resolved together — prevents sending e.g. gpt-5-mini to Anthropic
  const { model, provider } = await resolveAiModelAndProvider({
    podcastAiModel: podcast.aiModel,
    aiKey,
    plan: user.plan as 'FREE' | 'PRO',
  });

  const providerAiKey =
    podcast.aiModel && provider !== 'claude-code' && !useAdminCredits
      ? await getAiKey(userId, provider as AiProviderId)
      : aiKey;
  if (podcast.aiModel && provider !== 'claude-code' && !useAdminCredits && !providerAiKey) {
    throw new Error(`AI key for provider "${provider}" is required for script generation.`);
  }

  // Extract content from user-provided source URLs and append to discovery.sourceContent
  if (job.data.sourceUrls && job.data.sourceUrls.length > 0) {
    logger.info('Extracting content from user-provided source URLs', {
      podcastId,
      urlCount: String(job.data.sourceUrls.length),
    });
    const results = await Promise.allSettled(
      job.data.sourceUrls.slice(0, 5).map((url) => extractContent(url))
    );
    const extractedTexts = results
      .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof extractContent>>> => r.status === 'fulfilled')
      .map((r) => r.value.text)
      .filter(Boolean);

    if (extractedTexts.length > 0) {
      const appendedContent = extractedTexts.join('\n\n---\n\n');
      const existingContent = discovery.sourceContent || '';
      const newContent = existingContent
        ? `${existingContent}\n\n---\n\n### User-Provided Sources\n\n${appendedContent}`
        : `### User-Provided Sources\n\n${appendedContent}`;
      await prisma.discovery.update({
        where: { id: discoveryId },
        data: { sourceContent: newContent },
      });
      discovery.sourceContent = newContent;
      logger.info('Appended extracted source content', {
        podcastId,
        extractedCount: String(extractedTexts.length),
      });
    }
  }

  const sourceMetadata = discovery.sourceMetadata as SourceMetadata | null;

  // Apply tier caps to duration target
  const requestedDuration = discovery.durationTarget || 10;
  const cappedDuration = isFinite(tierFeatures.maxDurationMinutes)
    ? Math.min(requestedDuration, tierFeatures.maxDurationMinutes)
    : requestedDuration;

  // Cap speakers to tier limit
  const requestedSpeakers = discovery.speakers as Array<{ name: string; description: string }> | null;
  const cappedSpeakers = requestedSpeakers && requestedSpeakers.length > tierFeatures.maxSpeakers
    ? requestedSpeakers.slice(0, tierFeatures.maxSpeakers)
    : requestedSpeakers;

  // Fetch previous episode context and language mode for continuous learning briefings
  let previousEpisodesContext: string | undefined;
  let briefingLanguageMode: string | null = null;
  if (podcast.source === 'BRIEFING') {
    const briefingLog = await prisma.briefingLog.findFirst({
      where: { podcastId },
      select: { userBriefingId: true },
    });
    if (briefingLog?.userBriefingId) {
      const briefing = await prisma.userBriefing.findUnique({
        where: { id: briefingLog.userBriefingId },
        select: { continuousLearning: true, contextEpisodes: true, languageMode: true },
      });
      briefingLanguageMode = briefing?.languageMode ?? null;
      if (briefing?.continuousLearning) {
        const priorLogs = await prisma.briefingLog.findMany({
          where: {
            userBriefingId: briefingLog.userBriefingId,
            podcastId: { not: podcastId },
          },
          orderBy: { generatedAt: 'desc' },
          take: briefing.contextEpisodes,
          select: {
            scheduledDate: true,
            podcast: {
              select: {
                script: { select: { markdown: true } },
              },
            },
          },
        });
        const episodeSummaries = priorLogs
          .filter((log) => log.podcast.script?.markdown)
          .map((log) => `[Episode ${log.scheduledDate}]\n${log.podcast.script!.markdown}`);
        if (episodeSummaries.length > 0) {
          previousEpisodesContext = episodeSummaries.join('\n\n---\n\n');
          logger.info('Continuous learning context loaded', {
            podcastId,
            priorEpisodes: String(episodeSummaries.length),
          });
        }
      }
    }
  }

  const hasUserFeedback = job.data.userFeedback && job.data.previousTurns;

  const result = hasUserFeedback
    ? await generateScriptWithUserFeedback({
        topic: discovery.topic || '',
        depth: discovery.depth || 'standard',
        audienceLevel: discovery.audienceLevel || 'intermediate',
        audience: discovery.audience || 'general',
        focusAreas: discovery.focusAreas,
        tone: discovery.tone || 'casual',
        durationTarget: cappedDuration,
        sourceContent: discovery.sourceContent || undefined,
        sourceMetadata: sourceMetadata || undefined,
        speakers: cappedSpeakers ?? undefined,
        previousScript: job.data.previousTurns!,
        previousReferences: job.data.previousReferences ?? [],
        userFeedback: job.data.userFeedback!,
        apiKeyOverride: providerAiKey?.apiKey,
        model,
        provider,
        webSearchEnabled: tierFeatures.webSearchEnabled,
      })
    : await generateScript({
        topic: discovery.topic || '',
        depth: discovery.depth || 'standard',
        audienceLevel: discovery.audienceLevel || 'intermediate',
        audience: discovery.audience || 'general',
        focusAreas: discovery.focusAreas,
        tone: discovery.tone || 'casual',
        durationTarget: cappedDuration,
        sourceContent: discovery.sourceContent || undefined,
        sourceMetadata: sourceMetadata || undefined,
        speakers: cappedSpeakers ?? undefined,
        apiKeyOverride: providerAiKey?.apiKey,
        model,
        provider,
        webSearchEnabled: tierFeatures.webSearchEnabled,
        mode: podcast.verificationMode === 'showcase' ? 'demo' : 'standard',
        source: podcast.source,
        previousEpisodesContext,
        targetLanguage: podcast.language,
        languageMode: briefingLanguageMode,
      });

  await job.updateProgress(50);

  // Validate vocabulary markers match vocabulary entries before persisting
  if (result.vocabulary && result.vocabulary.length > 0) {
    const markerRegex = /\[V(\d+):[^\]]+\]/g;
    const markerNumbers = new Set<number>();
    for (const turn of result.turns) {
      let m;
      markerRegex.lastIndex = 0;
      while ((m = markerRegex.exec(turn.text)) !== null) {
        markerNumbers.add(parseInt(m[1], 10));
      }
    }
    const entryNumbers = new Set(result.vocabulary.map((v) => v.number));
    for (const num of markerNumbers) {
      if (!entryNumbers.has(num)) {
        logger.warn('Vocabulary marker without matching entry', { podcastId, markerNumber: String(num) });
      }
    }
    for (const num of entryNumbers) {
      if (!markerNumbers.has(num)) {
        logger.warn('Vocabulary entry without matching marker in script', { podcastId, entryNumber: String(num) });
      }
    }
  }

  // Save script + references + vocabulary atomically
  await prisma.$transaction(async (tx) => {
    await tx.script.create({
      data: {
        podcastId,
        turns: result.turns,
        soundCues: result.soundCues.length > 0 ? result.soundCues : undefined,
        markdown: result.markdown,
      },
    });

    if (result.references.length > 0) {
      await tx.reference.createMany({
        data: result.references.map((ref) => ({
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

    if (result.vocabulary && result.vocabulary.length > 0) {
      await tx.vocabularyEntry.createMany({
        data: result.vocabulary.map((v) => ({
          podcastId,
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
  });

  if (result.references.length > 0) {
    logger.info('References saved', { podcastId, count: String(result.references.length) });
  }
  if (result.vocabulary && result.vocabulary.length > 0) {
    logger.info('Vocabulary entries saved', { podcastId, count: String(result.vocabulary.length) });
  }

  if (result.places.length > 0) {
    logger.info('Places extracted from script', { podcastId, places: result.places.map((p) => p.name) });
  }

  // Collect all tag slugs upfront for a single batched lookup
  const allTagSlugs = new Set<string>();

  const audienceSlugMap: Record<string, string> = {
    kids: 'kids',
    teens: 'teens',
    family: 'family-friendly',
    general: 'general-audience',
    mature: 'mature-topics',
  };
  const audienceSlug = audienceSlugMap[discovery.audience || 'general'];
  if (audienceSlug) allTagSlugs.add(audienceSlug);

  // Detect language from script text
  const fullText = result.turns.map((t: { text: string }) => t.text).join(' ');
  const languageDetectionModel = getCheapestModelForProvider(provider as AiProviderId);
  if (!languageDetectionModel) {
    throw new Error(`Language detection model is not configured for provider "${provider}".`);
  }
  const detectedLanguage = await detectLanguage(fullText, {
    providerType: provider as AiProviderId,
    model: languageDetectionModel,
    apiKeyOverride: providerAiKey?.apiKey,
  });
  if (detectedLanguage) allTagSlugs.add(`lang-${detectedLanguage}`);

  // Production tag
  allTagSlugs.add('prod-ai-generated');

  // Episode type tag from discovery depth
  const depthToTypeSlug: Record<string, string> = {
    eli5: 'type-eli5',
    quick_overview: 'type-quick-overview',
    standard: 'type-explainer',
    deep_dive: 'type-deep-dive',
  };
  const typeSlug = depthToTypeSlug[discovery.depth || 'standard'];
  if (typeSlug) allTagSlugs.add(typeSlug);

  // Topic tags + parents
  const topicSlugs = matchTopicTags({
    topic: discovery.topic || '',
    focusAreas: discovery.focusAreas ?? [],
  });
  for (const slug of topicSlugs) {
    allTagSlugs.add(slug);
    const parent = TAG_PARENT_MAP[slug];
    if (parent) allTagSlugs.add(parent);
  }

  // Single batched DB lookup for all tags
  const allTags = await prisma.tag.findMany({
    where: { slug: { in: [...allTagSlugs] } },
  });
  const tagsBySlug = new Map(allTags.map((t) => [t.slug, t.id]));

  // Upsert all matching tags in parallel
  const tagUpserts: Promise<unknown>[] = [];
  for (const slug of allTagSlugs) {
    const tagId = tagsBySlug.get(slug);
    if (tagId) {
      tagUpserts.push(
        prisma.podcastTag.upsert({
          where: { podcastId_tagId: { podcastId, tagId } },
          update: {},
          create: { podcastId, tagId },
        }),
      );
    }
  }
  await Promise.all(tagUpserts);

  // Route to compile/QC step
  await prisma.podcast.update({
    where: { id: podcastId },
    data: {
      status: 'COMPILING',
      aiProvider: model.startsWith('claude-code:') ? 'claude-code' : provider,
      aiModel: model,
      language: podcast.language ?? detectedLanguage ?? undefined,
    },
  });
  await invalidatePodcastCache(podcastId);
  await publishPodcastStatus(podcastId, { status: 'COMPILING' });

  await addJob(compileScriptQueue, JobType.COMPILE_SCRIPT, {
    podcastId,
    userId,
  }, { jobId: `compile-${podcastId}-${Date.now()}` });

  logger.info('Script queued for compilation', {
    podcastId,
    references: String(result.references.length),
  });

  // Log API usage
  await logUsage({
    service: provider,
    model: model ?? result.model,
    category: 'script_generation',
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    podcastId,
    userId,
  });

  await logPipelineStageComplete(podcastId, 'script-generation');
  await job.updateProgress(100);
  logger.info('Script generation complete', {
    podcastId,
    references: String(result.references.length),
  });
}
