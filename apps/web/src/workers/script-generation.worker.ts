import { Job } from 'bullmq';
import { GenerateScriptPayload, addJob, JobType, compileScriptQueue } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { generateScript, generateScriptWithUserFeedback, type SourceMetadata } from '@/lib/script-generator';
import { extractContent } from '@/lib/extractors';
import { logUsage } from '@/lib/usage-logger';
import { getAiKey } from '@/lib/byok';
import { getCheapestModelForProvider, resolveAiModelAndProvider, type AiProviderId } from '@/lib/providers/ai-registry';
import { detectLanguage } from '@/lib/language-detect';
import { invalidateEpisodeCache, publishEpisodeStatus } from '@/lib/redis';
import { matchTopicTags, TAG_PARENT_MAP } from '@/lib/topic-tagger';
import { getGenerationFeatures } from '@/lib/generation-features';
import { logger } from '@/lib/logger';
import { logPipelineStageComplete } from '@/lib/pipeline-events';

export async function processScriptGeneration(job: Job<GenerateScriptPayload>): Promise<void> {
  const { episodeId, userId, discoveryId, useAdminCredits } = job.data;

  logger.info('Generating script', { episodeId });
  await job.updateProgress(10);

  // Idempotency: skip if script already exists
  const existingScript = await prisma.script.findUnique({
    where: { episodeId },
    select: { id: true },
  });

  if (existingScript) {
    logger.info('Script already exists, skipping to compile', { episodeId });

    await prisma.episode.update({
      where: { id: episodeId },
      data: { status: 'COMPILING' },
    });
    await invalidateEpisodeCache(episodeId);
    await publishEpisodeStatus(episodeId, { status: 'COMPILING' });

    await addJob(compileScriptQueue, JobType.COMPILE_SCRIPT, {
      episodeId,
      userId,
    }, { jobId: `compile-${episodeId}-${Date.now()}` });

    await job.updateProgress(100);
    return;
  }

  const [episode, discovery] = await Promise.all([
    prisma.episode.findUniqueOrThrow({ where: { id: episodeId }, select: { aiModel: true, verificationMode: true, source: true, language: true } }),
    prisma.discovery.findUniqueOrThrow({ where: { id: discoveryId } }),
  ]);

  const genFeatures = getGenerationFeatures();

  const aiKey = useAdminCredits || episode.aiModel ? null : await getAiKey(userId);
  if (!episode.aiModel && !aiKey) {
    throw new Error('AI model is required for script generation when no AI key is configured.');
  }

  // Model + provider resolved together — prevents sending e.g. gpt-5-mini to Anthropic
  const { model, provider } = await resolveAiModelAndProvider({
    episodeAiModel: episode.aiModel,
    aiKey,
  });

  const providerAiKey =
    episode.aiModel && provider !== 'claude-code' && !useAdminCredits
      ? await getAiKey(userId, provider as AiProviderId)
      : aiKey;
  if (episode.aiModel && provider !== 'claude-code' && !useAdminCredits && !providerAiKey) {
    throw new Error(`AI key for provider "${provider}" is required for script generation.`);
  }

  // Extract content from user-provided source URLs and append to discovery.sourceContent
  if (job.data.sourceUrls && job.data.sourceUrls.length > 0) {
    logger.info('Extracting content from user-provided source URLs', {
      episodeId,
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
        episodeId,
        extractedCount: String(extractedTexts.length),
      });
    }
  }

  const sourceMetadata = discovery.sourceMetadata as SourceMetadata | null;

  // Apply uniform safety cap to duration target.
  const requestedDuration = discovery.durationTarget || 10;
  const cappedDuration = isFinite(genFeatures.maxDurationMinutes)
    ? Math.min(requestedDuration, genFeatures.maxDurationMinutes)
    : requestedDuration;

  // Cap speakers to the uniform safety limit.
  const requestedSpeakers = discovery.speakers as Array<{ name: string; description: string }> | null;
  const cappedSpeakers = requestedSpeakers && requestedSpeakers.length > genFeatures.maxSpeakers
    ? requestedSpeakers.slice(0, genFeatures.maxSpeakers)
    : requestedSpeakers;

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
        webSearchEnabled: genFeatures.webSearchEnabled,
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
        webSearchEnabled: genFeatures.webSearchEnabled,
        mode: episode.verificationMode === 'showcase' ? 'demo' : 'standard',
        targetLanguage: episode.language,
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
        logger.warn('Vocabulary marker without matching entry', { episodeId, markerNumber: String(num) });
      }
    }
    for (const num of entryNumbers) {
      if (!markerNumbers.has(num)) {
        logger.warn('Vocabulary entry without matching marker in script', { episodeId, entryNumber: String(num) });
      }
    }
  }

  // Save script + references + vocabulary atomically
  await prisma.$transaction(async (tx) => {
    await tx.script.create({
      data: {
        episodeId,
        turns: result.turns,
        soundCues: result.soundCues.length > 0 ? result.soundCues : undefined,
        markdown: result.markdown,
      },
    });

    if (result.references.length > 0) {
      await tx.reference.createMany({
        data: result.references.map((ref) => ({
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

    if (result.vocabulary && result.vocabulary.length > 0) {
      await tx.vocabularyEntry.createMany({
        data: result.vocabulary.map((v) => ({
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
  });

  if (result.references.length > 0) {
    logger.info('References saved', { episodeId, count: String(result.references.length) });
  }
  if (result.vocabulary && result.vocabulary.length > 0) {
    logger.info('Vocabulary entries saved', { episodeId, count: String(result.vocabulary.length) });
  }

  if (result.places.length > 0) {
    logger.info('Places extracted from script', { episodeId, places: result.places.map((p) => p.name) });
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
        prisma.episodeTag.upsert({
          where: { episodeId_tagId: { episodeId, tagId } },
          update: {},
          create: { episodeId, tagId },
        }),
      );
    }
  }
  await Promise.all(tagUpserts);

  // Route to compile/QC step
  await prisma.episode.update({
    where: { id: episodeId },
    data: {
      status: 'COMPILING',
      aiProvider: model.startsWith('claude-code:') ? 'claude-code' : provider,
      aiModel: model,
      language: episode.language ?? detectedLanguage ?? undefined,
    },
  });
  await invalidateEpisodeCache(episodeId);
  await publishEpisodeStatus(episodeId, { status: 'COMPILING' });

  await addJob(compileScriptQueue, JobType.COMPILE_SCRIPT, {
    episodeId,
    userId,
  }, { jobId: `compile-${episodeId}-${Date.now()}` });

  logger.info('Script queued for compilation', {
    episodeId,
    references: String(result.references.length),
  });

  // Log API usage
  await logUsage({
    service: provider,
    model: model ?? result.model,
    category: 'script_generation',
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    episodeId,
    userId,
  });

  await logPipelineStageComplete(episodeId, 'script-generation');
  await job.updateProgress(100);
  logger.info('Script generation complete', {
    episodeId,
    references: String(result.references.length),
  });
}
