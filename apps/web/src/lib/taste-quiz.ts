import { createHash } from 'crypto';
import type { TasteQuestion, NewsTimeRange } from '@sotto/shared';
import { prisma } from './prisma';
import { resolveAutoModel, type PlanModelConfig } from './auto-model-config';
import { createAIProvider } from './providers/ai';
import { getProviderForModel, resolveAiModelAndProvider } from './providers/ai-registry';
import { getAiKey } from './byok';
import { INPUT_SANITIZATION_INSTRUCTIONS } from './safety-prompts';
import { loadAndRender } from './prompt-loader';
import { logUsage } from './usage-logger';
import { logger } from './logger';
import { inspireFailures } from './redis';
import { fetchNewsletterArticles, formatArticlesForPrompt } from './newsletter-fetcher';

function hashQuestion(text: string): string {
  return createHash('sha256').update(text.toLowerCase().trim()).digest('hex').slice(0, 12);
}

/**
 * Generate fresh taste quiz questions for a user using the platform's default LLM.
 * Questions are unique per user — previously answered questions are filtered out.
 */
export async function generateQuestions(
  userId: string,
  count: number
): Promise<TasteQuestion[]> {
  // Fetch taxonomy, user context, and prior answers in parallel
  const [categories, existingInterests, priorAnswers, autoFree] = await Promise.all([
    prisma.tag.findMany({
      where: { parentId: null },
      select: {
        name: true,
        slug: true,
        children: {
          select: { name: true, slug: true },
          orderBy: { name: 'asc' },
        },
      },
    }),
    prisma.userInterest.findMany({
      where: { userId },
      select: { tag: { select: { name: true, slug: true } }, weight: true, source: true },
    }),
    prisma.tasteQuizAnswer.findMany({
      where: { userId },
      select: { questionId: true, question: true, response: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    resolveAutoModel('FREE'),
  ]);

  const priorQuestionIds = new Set(priorAnswers.map((a) => a.questionId));

  // Build taxonomy string for the prompt
  const taxonomyLines = categories.map((cat) => {
    const children = cat.children.map((c) => c.slug).join(', ');
    return `${cat.slug}: [${children}]`;
  });

  // Build existing interest summary
  const interestSummary = existingInterests
    .filter((i) => i.weight > 0)
    .map((i) => `${i.tag.name} (${i.source}, weight: ${i.weight})`)
    .join(', ');

  const dislikedSummary = existingInterests
    .filter((i) => i.weight < 0)
    .map((i) => i.tag.name)
    .join(', ');

  // Recent answered questions (to avoid repeats)
  const recentQuestions = priorAnswers
    .slice(0, 50)
    .map((a) => `- "${a.question}" → ${a.response}`)
    .join('\n');

  // Request extra to account for hash collisions with prior answers
  const requestCount = count + Math.min(priorAnswers.length, 10);

  const systemPrompt = loadAndRender('feeds/taste-quiz.md', {
    REQUEST_COUNT: String(requestCount),
    TAXONOMY: taxonomyLines.join('\n'),
    INTEREST_SUMMARY: interestSummary ? `User's current interests: ${interestSummary}` : 'User has no interests yet — explore broadly.',
    DISLIKED_SUMMARY: dislikedSummary ? `User dislikes: ${dislikedSummary}` : '',
    RECENT_QUESTIONS: recentQuestions ? `Previously asked questions (DO NOT repeat these):\n${recentQuestions}` : '',
  });

  const ai = createAIProvider(autoFree.aiProvider);
  const response = await ai.generateResponse(
    systemPrompt,
    [{ role: 'user', content: `Generate ${requestCount} taste quiz questions.` }],
    { model: autoFree.aiModel, maxTokens: 4096, temperature: 1.0 }
  );

  logUsage({
    service: autoFree.aiProvider,
    model: response.model,
    category: 'taste_quiz',
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    userId,
  });

  // Parse the JSON response
  let rawQuestions: Array<{ text: string; topic?: string; tagSlugs: string[]; category: string }>;
  try {
    // Strip markdown code fences if present
    const cleaned = response.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    rawQuestions = JSON.parse(cleaned);
  } catch (err) {
    logger.error('Failed to parse taste quiz LLM response', { error: err, content: response.content });
    throw new Error('Failed to generate quiz questions');
  }

  if (!Array.isArray(rawQuestions)) {
    throw new Error('Invalid quiz response format');
  }

  // Collect all valid tag slugs for validation
  const validSlugs = new Set<string>();
  for (const cat of categories) {
    validSlugs.add(cat.slug);
    for (const child of cat.children) {
      validSlugs.add(child.slug);
    }
  }

  // Process, filter, and deduplicate
  const questions: TasteQuestion[] = [];
  const seenIds = new Set<string>();

  for (const q of rawQuestions) {
    if (!q.text || !Array.isArray(q.tagSlugs) || q.tagSlugs.length === 0) continue;

    const id = hashQuestion(q.text);

    // Skip if already answered or duplicate in this batch
    if (priorQuestionIds.has(id) || seenIds.has(id)) continue;

    // Filter to valid slugs only
    const validTagSlugs = q.tagSlugs.filter((s: string) => validSlugs.has(s));
    if (validTagSlugs.length === 0) continue;

    seenIds.add(id);
    questions.push({
      id,
      text: q.text,
      topic: q.topic || q.text,
      tagSlugs: validTagSlugs,
      category: validSlugs.has(q.category) ? q.category : validTagSlugs[0],
    });

    if (questions.length >= count) break;
  }

  return questions;
}

export interface InspireContext {
  taxonomyLines: string[];
  validSlugs: Set<string>;
  priorQuestionIds: Set<string>;
  autoModel: PlanModelConfig;
}

export async function loadInspireContext(userId: string, opts?: { model?: string; plan?: 'FREE' | 'PRO' }): Promise<InspireContext> {
  const [categories, priorAnswers, autoFreeConfig] = await Promise.all([
    prisma.tag.findMany({
      where: { parentId: null },
      select: {
        name: true,
        slug: true,
        children: {
          select: { name: true, slug: true },
          orderBy: { name: 'asc' },
        },
      },
    }),
    prisma.tasteQuizAnswer.findMany({
      where: { userId },
      select: { questionId: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    resolveAutoModel(opts?.plan ?? 'FREE'),
  ]);

  const validSlugs = new Set<string>();
  for (const cat of categories) {
    validSlugs.add(cat.slug);
    for (const child of cat.children) {
      validSlugs.add(child.slug);
    }
  }

  const taxonomyLines = categories.map((cat) => {
    const children = cat.children.map((c) => c.slug).join(', ');
    return `${cat.slug}: [${children}]`;
  });

  // If caller passed an explicit model, override the auto-resolved config
  const resolvedAutoModel = opts?.model
    ? { ...autoFreeConfig, aiModel: opts.model }
    : autoFreeConfig;

  return {
    taxonomyLines,
    validSlugs,
    priorQuestionIds: new Set(priorAnswers.map((a) => a.questionId)),
    autoModel: resolvedAutoModel,
  };
}

/**
 * Resolve the AI provider, API key, and model for Inspire sections.
 * Ensures the model always matches the resolved provider to prevent
 * cross-provider 404s (e.g. sending 'gpt-5-mini' to Anthropic).
 */
function resolveInspireProvider(
  resolved: { provider: string; source: string; apiKey?: string; model?: string } | null,
  autoModel: PlanModelConfig,
  explicitModel?: string
): { providerType: string; apiKey: string | undefined; model: string } {
  const providerType = resolved?.provider ?? autoModel.aiProvider;
  const apiKey = resolved?.source === 'byok' ? resolved.apiKey : undefined;

  // Prefer: explicit model → BYOK key model → auto config model
  const candidateModel = explicitModel ?? resolved?.model ?? autoModel.aiModel;

  // Validate model belongs to target provider — never silently substitute
  const modelOwner = getProviderForModel(candidateModel);
  if (!modelOwner) {
    throw new Error(
      `AI model "${candidateModel}" is not registered with any provider. ` +
      `Update the model in Admin → Auto Models. Provider: ${providerType}`
    );
  }
  if (modelOwner !== providerType) {
    throw new Error(
      `AI model "${candidateModel}" belongs to "${modelOwner}", not "${providerType}". ` +
      `Update the model/provider pair in Admin → Auto Models.`
    );
  }

  return { providerType, apiKey, model: candidateModel };
}

interface ParseOptions {
  /** When true, keep questions even if no slugs match the taxonomy (uses category or 'general' as fallback). */
  lenient?: boolean;
}

interface ParseResult {
  questions: TasteQuestion[];
  /** When questions is empty, explains why (for admin diagnostics). */
  emptyReason?: string;
}

function parseAndFilterQuestions(
  responseText: string,
  count: number,
  validSlugs: Set<string>,
  priorQuestionIds: Set<string>,
  opts?: ParseOptions
): ParseResult {
  let rawQuestions: Array<{ text: string; topic?: string; tagSlugs: string[]; category: string; sourceUrl?: string; sourceName?: string }>;
  try {
    const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      logger.warn('parseAndFilterQuestions: no JSON array found', {
        responseLength: String(responseText.length),
        preview: responseText.slice(0, 300),
      });
      return { questions: [], emptyReason: `No JSON array in LLM response (${responseText.length} chars). Preview: ${responseText.slice(0, 200)}` };
    }
    rawQuestions = JSON.parse(jsonMatch[0]);
  } catch (err) {
    logger.warn('parseAndFilterQuestions: JSON parse failed', {
      error: (err as Error).message,
      responseLength: String(responseText.length),
      preview: responseText.slice(0, 300),
    });
    return { questions: [], emptyReason: `JSON parse failed: ${(err as Error).message}. Preview: ${responseText.slice(0, 200)}` };
  }

  if (!Array.isArray(rawQuestions)) return { questions: [], emptyReason: 'LLM response was not an array' };

  const questions: TasteQuestion[] = [];
  const seenIds = new Set<string>();
  const lenient = opts?.lenient ?? false;
  let skippedNoText = 0;
  let skippedDuped = 0;
  let skippedSlugs = 0;

  for (const q of rawQuestions) {
    if (!q.text) { skippedNoText++; continue; }
    // Strip Claude web search citation tags: <cite index="N-M">...</cite> → just the inner text
    q.text = q.text.replace(/<cite[^>]*>/g, '').replace(/<\/cite>/g, '');
    if (q.topic) q.topic = q.topic.replace(/<cite[^>]*>/g, '').replace(/<\/cite>/g, '');
    const id = hashQuestion(q.text);
    if (priorQuestionIds.has(id) || seenIds.has(id)) { skippedDuped++; continue; }

    const suppliedSlugs = Array.isArray(q.tagSlugs) ? q.tagSlugs : [];
    let validTagSlugs = suppliedSlugs.filter((s: string) => validSlugs.has(s));

    // Fall back to category slug if no tag slugs matched the taxonomy
    if (validTagSlugs.length === 0 && q.category && validSlugs.has(q.category)) {
      validTagSlugs = [q.category];
    }

    // In lenient mode (news), keep the question with the raw slugs or a generic fallback
    if (validTagSlugs.length === 0) {
      if (!lenient) { skippedSlugs++; continue; }
      validTagSlugs = suppliedSlugs.length > 0 ? suppliedSlugs : ['general'];
    }

    seenIds.add(id);
    const question: TasteQuestion = {
      id,
      text: q.text,
      topic: q.topic || q.text,
      tagSlugs: validTagSlugs,
      category: validSlugs.has(q.category) ? q.category : (validTagSlugs[0] ?? 'general'),
    };
    if (q.sourceUrl) question.sourceUrl = q.sourceUrl;
    if (q.sourceName) question.sourceName = q.sourceName;
    questions.push(question);
    if (questions.length >= count) break;
  }

  logger.info('parseAndFilterQuestions', {
    raw: String(rawQuestions.length),
    kept: String(questions.length),
    skippedNoText: String(skippedNoText),
    skippedDuped: String(skippedDuped),
    skippedSlugs: String(skippedSlugs),
  });

  const emptyReason = questions.length === 0
    ? `All ${rawQuestions.length} filtered out: ${skippedNoText} no text, ${skippedDuped} duplicates, ${skippedSlugs} invalid slugs`
    : undefined;

  return { questions, emptyReason };
}

/**
 * Generate interest-based "For You" questions. No web search — fast.
 * Combines user interests in unexpected ways, explores adjacent topics.
 * Falls back to diverse curiosity-driven questions when no interests exist.
 */
export async function generateForYouQuestions(
  userId: string,
  count: number,
  topic?: string,
  preloadedCtx?: InspireContext,
  model?: string
): Promise<TasteQuestion[]> {

  const [ctx, existingInterests] = await Promise.all([
    preloadedCtx ?? loadInspireContext(userId),
    prisma.userInterest.findMany({
      where: { userId },
      select: { tag: { select: { name: true, slug: true } }, weight: true },
    }),
  ]);

  const interestNames = existingInterests
    .filter((i) => i.weight > 0)
    .map((i) => i.tag.name);

  const interestContext = interestNames.length > 0
    ? `The user is interested in: ${interestNames.join(', ')}.

Your job is to COMBINE these interests in unexpected, creative ways. Examples:
- If they like "AI" and "History" → "Ancient Rome had concrete that healed itself — and we're only now figuring out AI that can do the same"
- If they like "Psychology" and "Sports" → "Olympic athletes don't just train their bodies — the mental tricks they use to override fear are straight out of military psychology"

Also explore topics ADJACENT to their interests — things they haven't explicitly said but would likely enjoy based on their taste profile.`
    : `The user has no stated interests yet. Generate broadly appealing, curiosity-driven questions across diverse topics. Aim for surprise and delight — topics that make someone think "I never knew I wanted to learn about that."`;

  // Strip quotes and newlines from user-supplied topic to prevent prompt injection
  const safeTopic = topic?.replace(/["\n\r]/g, ' ').trim();

  const topicContext = safeTopic
    ? `\n\nIMPORTANT: The user is specifically interested in "${safeTopic}" right now. ALL questions must relate to this topic area. Still be creative and specific — don't just ask generic questions about "${safeTopic}".`
    : '';

  const requestCount = count + 5;

  const systemPrompt = loadAndRender('feeds/for-you.md', {
    REQUEST_COUNT: String(requestCount),
    INTEREST_CONTEXT: interestContext,
    TOPIC_CONTEXT: topicContext,
    TAXONOMY: ctx.taxonomyLines.join('\n'),
    INPUT_SANITIZATION: INPUT_SANITIZATION_INSTRUCTIONS,
  });

  try {
    const userRecord = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } });
    const plan = userRecord?.plan as 'FREE' | 'PRO' | undefined;
    const aiKey = await getAiKey(userId).catch(() => null);
    const resolved = await resolveAiModelAndProvider({ aiKey, plan }).then(
      ({ model: m, provider }) => ({ provider, source: aiKey ? 'byok' as const : 'platform' as const, apiKey: aiKey?.apiKey, model: m })
    ).catch(() => null);
    const { providerType, apiKey, model: resolvedModel } = resolveInspireProvider(resolved, ctx.autoModel, model);
    logger.info('Inspire forYou provider resolved', { provider: providerType, model: resolvedModel, source: resolved?.source ?? 'auto' });
    const llmStart = Date.now();

    const ai = createAIProvider(providerType);
    const result = await ai.generateResponse(
      systemPrompt,
      [{ role: 'user', content: `Generate ${requestCount} personalized inspire questions.` }],
      { model: resolvedModel, apiKeyOverride: apiKey, maxTokens: 16384, temperature: 1.0 }
    );

    const durationMs = Date.now() - llmStart;

    const { questions, emptyReason } = parseAndFilterQuestions(
      result.content, count, ctx.validSlugs, ctx.priorQuestionIds,
      { lenient: true }
    );

    logUsage({
      service: providerType,
      model: result.model,
      category: 'inspire_foryou',
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs,
      userId,
      metadata: { questionCount: questions.length, topic: topic ?? null },
    });

    if (emptyReason) {
      inspireFailures.push({ section: 'forYou', reason: emptyReason, userId, timestamp: new Date().toISOString() }).catch(() => {});
    }

    return questions;
  } catch (err) {
    const reason = `LLM error: ${(err as Error).message}`;
    logger.warn('Failed to generate ForYou questions', { error: (err as Error).message });
    inspireFailures.push({ section: 'forYou', reason, userId, timestamp: new Date().toISOString() }).catch(() => {});
    return [];
  }
}

/**
 * Generate serendipitous "Curiosity" questions — random topics for learning out of pure curiosity.
 * No web search, no personalization. Maximum diversity and surprise.
 */
export async function generateCuriosityQuestions(
  userId: string,
  count: number,
  topic?: string,
  preloadedCtx?: InspireContext,
  model?: string
): Promise<TasteQuestion[]> {

  const ctx = preloadedCtx ?? await loadInspireContext(userId);

  const safeTopic = topic?.replace(/["\n\r]/g, ' ').trim();

  const topicContext = safeTopic
    ? `\n\nThe user wants curiosity questions about "${safeTopic}". ALL questions must relate to this topic area, but still be surprising, counterintuitive, and rabbit-hole-worthy.`
    : '';

  const requestCount = count + 5;

  const systemPrompt = loadAndRender('feeds/curiosity.md', {
    REQUEST_COUNT: String(requestCount),
    TOPIC_CONTEXT: topicContext,
    TAXONOMY: ctx.taxonomyLines.join('\n'),
    INPUT_SANITIZATION: INPUT_SANITIZATION_INSTRUCTIONS,
  });

  try {
    const userRecord = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } });
    const plan = userRecord?.plan as 'FREE' | 'PRO' | undefined;
    const aiKey = await getAiKey(userId).catch(() => null);
    const resolved = await resolveAiModelAndProvider({ aiKey, plan }).then(
      ({ model: m, provider }) => ({ provider, source: aiKey ? 'byok' as const : 'platform' as const, apiKey: aiKey?.apiKey, model: m })
    ).catch(() => null);
    const { providerType, apiKey, model: resolvedModel } = resolveInspireProvider(resolved, ctx.autoModel, model);
    logger.info('Inspire curiosity provider resolved', { provider: providerType, model: resolvedModel, source: resolved?.source ?? 'auto' });
    const llmStart = Date.now();

    const ai = createAIProvider(providerType);
    const result = await ai.generateResponse(
      systemPrompt,
      [{ role: 'user', content: `Generate ${requestCount} curiosity questions.` }],
      { model: resolvedModel, apiKeyOverride: apiKey, maxTokens: 16384, temperature: 1.0 }
    );

    const durationMs = Date.now() - llmStart;

    const { questions, emptyReason } = parseAndFilterQuestions(
      result.content, count, ctx.validSlugs, ctx.priorQuestionIds,
      { lenient: true }
    );

    logUsage({
      service: providerType,
      model: result.model,
      category: 'inspire_curiosity',
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs,
      userId,
      metadata: { questionCount: questions.length, topic: topic ?? null },
    });

    if (emptyReason) {
      inspireFailures.push({ section: 'curiosity', reason: emptyReason, userId, timestamp: new Date().toISOString() }).catch(() => {});
    }

    return questions;
  } catch (err) {
    const reason = `LLM error: ${(err as Error).message}`;
    logger.warn('Failed to generate Curiosity questions', { error: (err as Error).message });
    inspireFailures.push({ section: 'curiosity', reason, userId, timestamp: new Date().toISOString() }).catch(() => {});
    return [];
  }
}

// Re-export for consumers that import from this file
export type { NewsTimeRange } from '@sotto/shared';

const NEWS_TIME_LABELS: Record<NewsTimeRange, string> = {
  '1h': 'the past hour',
  '12h': 'the past 12 hours',
  '24h': 'the past 24 hours',
  '1w': 'the past week',
  '1m': 'the past month',
};

/**
 * Generate current-events "In the News" questions using web search.
 * Must reference specific real events/people/dates from the given time range.
 * Accepts excludeTopics to avoid overlap with ForYou questions.
 */
export async function generateNewsQuestions(
  userId: string,
  count: number,
  excludeTopics: string[] = [],
  timeRange: NewsTimeRange = '1w',
  topic?: string,
  preloadedCtx?: InspireContext,
  model?: string
): Promise<TasteQuestion[]> {

  const ctx = preloadedCtx ?? await loadInspireContext(userId);

  const timeLabel = NEWS_TIME_LABELS[timeRange];

  const excludeContext = excludeTopics.length > 0
    ? `\n\nIMPORTANT: The following topics are already shown in a different tab. Do NOT generate questions about similar subjects:\n${excludeTopics.map((t) => `- ${t}`).join('\n')}`
    : '';

  // Strip quotes and newlines from user-supplied topic
  const safeNewsTopic = topic?.replace(/["\n\r]/g, ' ').trim();

  const topicFocus = safeNewsTopic
    ? `\n\nThe user wants news about "${safeNewsTopic}". Prioritize questions related to this area. If there are no recent news stories specifically about "${safeNewsTopic}", broaden to closely related fields, recent developments in the broader domain, or historically significant events in "${safeNewsTopic}" that remain relevant.`
    : '';

  const requestCount = count + 5;

  const diversityNote = safeNewsTopic
    ? `Focus questions on "${safeNewsTopic}" and closely related areas`
    : 'Cover diverse topics: science, politics, tech, business, culture, sports';

  // Try newsletter-grounded path first (avoids web search, saves tokens + latency)
  const articles = await fetchNewsletterArticles(timeRange).catch(() => []);
  const useNewsletterPath = articles.length >= 3;

  const systemPrompt = useNewsletterPath
    ? loadAndRender('feeds/news-from-newsletters.md', {
        TIME_LABEL: timeLabel,
        REQUEST_COUNT: String(requestCount),
        NEWSLETTER_ARTICLES: formatArticlesForPrompt(articles),
        DIVERSITY_NOTE: diversityNote,
        EXCLUDE_CONTEXT: excludeContext,
        TOPIC_FOCUS: topicFocus,
        TAXONOMY: ctx.taxonomyLines.join('\n'),
        INPUT_SANITIZATION: INPUT_SANITIZATION_INSTRUCTIONS,
      })
    : loadAndRender('feeds/news.md', {
        TIME_LABEL: timeLabel,
        REQUEST_COUNT: String(requestCount),
        DIVERSITY_NOTE: diversityNote,
        EXCLUDE_CONTEXT: excludeContext,
        TOPIC_FOCUS: topicFocus,
        TAXONOMY: ctx.taxonomyLines.join('\n'),
        INPUT_SANITIZATION: INPUT_SANITIZATION_INSTRUCTIONS,
      });

  try {
    const userRecord = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } });
    const plan = userRecord?.plan as 'FREE' | 'PRO' | undefined;
    const aiKey = await getAiKey(userId).catch(() => null);
    const resolved = await resolveAiModelAndProvider({ aiKey, plan }).then(
      ({ model: m, provider }) => ({ provider, source: aiKey ? 'byok' as const : 'platform' as const, apiKey: aiKey?.apiKey, model: m })
    ).catch(() => null);
    const { providerType, apiKey, model: resolvedModel } = resolveInspireProvider(resolved, ctx.autoModel, model);
    logger.info('Inspire news provider resolved', { provider: providerType, model: resolvedModel, source: resolved?.source ?? 'auto' });
    const llmStart = Date.now();

    const ai = createAIProvider(providerType);
    const result = await ai.generateResponse(
      systemPrompt,
      [{ role: 'user', content: `Generate ${requestCount} current-events questions.` }],
      { model: resolvedModel, apiKeyOverride: apiKey, maxTokens: 16384, temperature: 1.0, useWebSearch: !useNewsletterPath }
    );

    const durationMs = Date.now() - llmStart;

    const { questions, emptyReason } = parseAndFilterQuestions(
      result.content, count, ctx.validSlugs, ctx.priorQuestionIds,
      { lenient: true }
    );

    logUsage({
      service: providerType,
      model: result.model,
      category: 'inspire_news',
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs,
      userId,
      metadata: { questionCount: questions.length, topic: topic ?? null, timeRange, useNewsletterPath },
    });

    if (emptyReason) {
      inspireFailures.push({ section: 'news', reason: emptyReason, userId, timestamp: new Date().toISOString() }).catch(() => {});
    }

    return questions;
  } catch (err) {
    const reason = `LLM error: ${(err as Error).message}`;
    logger.warn('Failed to generate News questions', { error: (err as Error).message });
    inspireFailures.push({ section: 'news', reason, userId, timestamp: new Date().toISOString() }).catch(() => {});
    return [];
  }
}
