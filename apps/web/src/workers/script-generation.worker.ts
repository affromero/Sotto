import { Job } from 'bullmq';
import { GenerateScriptPayload, addJob, JobType, scriptVerificationQueue } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { generateScript, generateScriptWithUserFeedback, type SourceMetadata } from '@/lib/script-generator';
import { logUsage } from '@/lib/usage-logger';
import { getAiKey, hasByokKey } from '@/lib/byok';
import { resolveAiModelAndProvider } from '@/lib/providers/ai-registry';
import { detectLanguage } from '@/lib/language-detect';
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
    logger.info('Script already exists, skipping to verification', { podcastId });

    await prisma.podcast.update({
      where: { id: podcastId },
      data: { status: 'VERIFYING_SCRIPT' },
    });

    await addJob(scriptVerificationQueue, JobType.VERIFY_SCRIPT, {
      podcastId,
      userId,
      discoveryId,
      useAdminCredits,
    }, { jobId: `verify-${podcastId}-${Date.now()}-1` });

    await job.updateProgress(100);
    return;
  }

  const [aiKey, hasTts, user, podcast, discovery] = await Promise.all([
    useAdminCredits ? Promise.resolve(null) : getAiKey(userId),
    useAdminCredits ? Promise.resolve(true) : hasByokKey(userId),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { plan: true, role: true } }),
    prisma.podcast.findUniqueOrThrow({ where: { id: podcastId }, select: { aiModel: true } }),
    prisma.discovery.findUniqueOrThrow({ where: { id: discoveryId } }),
  ]);

  const tierFeatures = getTierFeatures(user.plan as 'FREE' | 'PRO', hasTts, user.role);

  // Model + provider resolved together — prevents sending e.g. gpt-5-mini to Anthropic
  const { model, provider } = await resolveAiModelAndProvider({
    podcastAiModel: podcast.aiModel,
    aiKey,
    plan: user.plan as 'FREE' | 'PRO',
  });

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
        apiKeyOverride: aiKey?.apiKey,
        model,
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
        apiKeyOverride: aiKey?.apiKey,
        model,
        webSearchEnabled: tierFeatures.webSearchEnabled,
      });

  await job.updateProgress(50);

  // Save script (including sound cues for the stitching pipeline)
  await prisma.script.create({
    data: {
      podcastId,
      turns: result.turns,
      soundCues: result.soundCues.length > 0 ? result.soundCues : undefined,
      markdown: result.markdown,
    },
  });

  // Persist references
  if (result.references.length > 0) {
    await prisma.reference.createMany({
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
    logger.info('References saved', { podcastId, count: String(result.references.length) });
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
  const detectedLanguage = detectLanguage(fullText);
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

  // Route to script verification (handles both with and without references)
  await prisma.podcast.update({
    where: { id: podcastId },
    data: {
      status: 'VERIFYING_SCRIPT',
      aiProvider: model.startsWith('claude-code:') ? 'claude-code' : provider,
      aiModel: model,
      language: detectedLanguage ?? undefined,
    },
  });

  await addJob(scriptVerificationQueue, JobType.VERIFY_SCRIPT, {
    podcastId,
    userId,
    discoveryId,
    useAdminCredits,
  }, { jobId: `verify-${podcastId}-${Date.now()}-1` });

  logger.info('Script queued for verification', {
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
