import { createHash } from 'crypto';
import type { TasteQuestion } from '@sotto/shared';
import { prisma } from './prisma';
import { getFreeTierConfig } from './free-tier-config';
import { createAIProvider } from './providers/ai';
import { resolveAiProvider } from './providers/ai';
import { WEB_SEARCH_TOOL } from './claude';
import { INPUT_SANITIZATION_INSTRUCTIONS } from './safety-prompts';
import { logger } from './logger';

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
  const [categories, existingInterests, priorAnswers, freeTierConfig] = await Promise.all([
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
    getFreeTierConfig(),
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

  const systemPrompt = `You generate taste quiz questions for a podcast discovery platform called Sotto.

Each question should be a yes/no prompt like "Would you listen to a podcast about...?" or "Are you curious about...?" or "Do you enjoy debates about...?"

Rules:
- Generate exactly ${requestCount} questions
- Each question maps to 1-3 existing tag slugs from the taxonomy below
- Mix question styles: curiosity-driven, opinion-based, niche deep-dives, contrarian takes
- Questions should be specific and vivid, not generic ("Would you listen to a podcast about why cats purr?" not "Are you interested in animals?")
- Never repeat questions the user has already answered
- Bias toward unexplored areas the user hasn't engaged with yet
- Category is the parent slug the question primarily belongs to

Taxonomy (parent: [children]):
${taxonomyLines.join('\n')}

${interestSummary ? `User's current interests: ${interestSummary}` : 'User has no interests yet — explore broadly.'}
${dislikedSummary ? `User dislikes: ${dislikedSummary}` : ''}

${recentQuestions ? `Previously asked questions (DO NOT repeat these):\n${recentQuestions}` : ''}

Respond with a JSON array only, no markdown. Each item:
{"text": "Would you listen to a podcast about how octopuses taste the world by licking their arms?", "topic": "how octopuses taste the world by licking their arms", "tagSlugs": ["slug1"], "category": "parent-slug"}`;

  const ai = createAIProvider(freeTierConfig.aiProvider);
  const response = await ai.generateResponse(
    systemPrompt,
    [{ role: 'user', content: `Generate ${requestCount} taste quiz questions.` }],
    { model: freeTierConfig.aiModel, maxTokens: 4096, temperature: 1.0 }
  );

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
  freeTierConfig: { aiProvider: string; aiModel: string };
}

export async function loadInspireContext(userId: string): Promise<InspireContext> {
  const [categories, priorAnswers, freeTierConfig] = await Promise.all([
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
    getFreeTierConfig(),
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

  return {
    taxonomyLines,
    validSlugs,
    priorQuestionIds: new Set(priorAnswers.map((a) => a.questionId)),
    freeTierConfig,
  };
}

interface ParseOptions {
  /** When true, keep questions even if no slugs match the taxonomy (uses category or 'general' as fallback). */
  lenient?: boolean;
}

function parseAndFilterQuestions(
  responseText: string,
  count: number,
  validSlugs: Set<string>,
  priorQuestionIds: Set<string>,
  opts?: ParseOptions
): TasteQuestion[] {
  let rawQuestions: Array<{ text: string; topic?: string; tagSlugs: string[]; category: string }>;
  try {
    const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      logger.warn('parseAndFilterQuestions: no JSON array found', {
        responseLength: String(responseText.length),
        preview: responseText.slice(0, 300),
      });
      return [];
    }
    rawQuestions = JSON.parse(jsonMatch[0]);
  } catch (err) {
    logger.warn('parseAndFilterQuestions: JSON parse failed', {
      error: (err as Error).message,
      responseLength: String(responseText.length),
      preview: responseText.slice(0, 300),
    });
    return [];
  }

  if (!Array.isArray(rawQuestions)) return [];

  const questions: TasteQuestion[] = [];
  const seenIds = new Set<string>();
  const lenient = opts?.lenient ?? false;
  let skippedNoText = 0;
  let skippedDuped = 0;
  let skippedSlugs = 0;

  for (const q of rawQuestions) {
    if (!q.text) { skippedNoText++; continue; }
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
    questions.push({
      id,
      text: q.text,
      topic: q.topic || q.text,
      tagSlugs: validTagSlugs,
      category: validSlugs.has(q.category) ? q.category : (validTagSlugs[0] ?? 'general'),
    });
    if (questions.length >= count) break;
  }

  logger.info('parseAndFilterQuestions', {
    raw: String(rawQuestions.length),
    kept: String(questions.length),
    skippedNoText: String(skippedNoText),
    skippedDuped: String(skippedDuped),
    skippedSlugs: String(skippedSlugs),
  });

  return questions;
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
  preloadedCtx?: InspireContext
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
- If they like "AI" and "History" → "Would you listen to a podcast about how ancient civilizations would have used artificial intelligence?"
- If they like "Psychology" and "Sports" → "Would you listen to a podcast about the mental tricks Olympic athletes use to overcome fear?"

Also explore topics ADJACENT to their interests — things they haven't explicitly said but would likely enjoy based on their taste profile.`
    : `The user has no stated interests yet. Generate broadly appealing, curiosity-driven questions across diverse topics. Aim for surprise and delight — topics that make someone think "I never knew I wanted to learn about that."`;

  // Strip quotes and newlines from user-supplied topic to prevent prompt injection
  const safeTopic = topic?.replace(/["\n\r]/g, ' ').trim();

  const topicContext = safeTopic
    ? `\n\nIMPORTANT: The user is specifically interested in "${safeTopic}" right now. ALL questions must relate to this topic area. Still be creative and specific — don't just ask generic questions about "${safeTopic}".`
    : '';

  const requestCount = count + 5;

  const systemPrompt = `You generate personalized podcast topic questions for Sotto's "For You" feed.

Each question should be a compelling yes/no prompt like "Would you listen to a podcast about...?" — specific enough that answering "yes" means the user wants a podcast created on that exact topic.

${interestContext}${topicContext}

Rules:
- Generate exactly ${requestCount} questions
- Each question maps to 1-3 existing tag slugs from the taxonomy
- Questions must be specific, vivid, and concrete — not generic
- Focus on CREATIVE COMBINATIONS and ADJACENT INTERESTS — not straightforward "more of what you like"
- Category is the parent slug the question belongs to

Taxonomy (parent: [children]):
${ctx.taxonomyLines.join('\n')}
${INPUT_SANITIZATION_INSTRUCTIONS}

Respond with a JSON array only, no markdown. Each item:
{"text": "Would you listen to a podcast about how octopuses taste the world by licking their arms?", "topic": "how octopuses taste the world by licking their arms", "tagSlugs": ["slug1"], "category": "parent-slug"}`;

  try {
    // Use user's BYOK key if available (faster than platform claude-code CLI)
    const resolved = await resolveAiProvider(userId).catch(() => null);
    let responseText: string;
    const llmStart = Date.now();

    if (resolved?.apiKey && resolved.provider === 'anthropic') {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: resolved.apiKey });
      const response = await client.messages.create({
        model: ctx.freeTierConfig.aiModel || 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [{ role: 'user', content: systemPrompt }],
      });
      const textBlock = response.content.find((block) => block.type === 'text');
      responseText = textBlock?.type === 'text' ? textBlock.text : '';
    } else {
      const ai = createAIProvider(ctx.freeTierConfig.aiProvider);
      const result = await ai.generateResponse(
        systemPrompt,
        [{ role: 'user', content: `Generate ${requestCount} personalized inspire questions.` }],
        { model: ctx.freeTierConfig.aiModel, maxTokens: 2048, temperature: 1.0 }
      );
      responseText = result.content;
    }

    const durationMs = Date.now() - llmStart;

    const questions = parseAndFilterQuestions(
      responseText, count, ctx.validSlugs, ctx.priorQuestionIds
    );

    // Fire-and-forget timing log
    prisma.apiUsageLog.create({
      data: {
        userId,
        service: 'anthropic',
        category: 'inspire_foryou',
        totalCost: 0,
        durationMs,
        metadata: {
          model: ctx.freeTierConfig.aiModel,
          questionCount: questions.length,
          topic: topic ?? null,
        },
      },
    }).catch(() => {});

    return questions;
  } catch (err) {
    logger.warn('Failed to generate ForYou questions', { error: (err as Error).message });
    return [];
  }
}

export type NewsTimeRange = '1h' | '12h' | '24h' | '1w' | '1m';

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
  preloadedCtx?: InspireContext
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

  const systemPrompt = `You generate current-events podcast topic questions for Sotto's "In the News" feed.

Search the web for notable events, breakthroughs, controversies, and developments from ${timeLabel}. Prefer questions grounded in specific, real, verifiable events.

Rules:
- Generate exactly ${requestCount} questions as a JSON array
- Each question should reference a real event, person, date, or development — prefer recent but fall back to relevant ongoing stories if no recent results exist
- Each question maps to 1-3 existing tag slugs from the taxonomy
- Questions must feel timely and compelling — "Would you listen to a podcast about [something newsworthy]?"
- Category is the parent slug the question belongs to
- NEVER refuse or apologize — always generate the full count of questions
- ${diversityNote}${excludeContext}${topicFocus}

Taxonomy (parent: [children]):
${ctx.taxonomyLines.join('\n')}
${INPUT_SANITIZATION_INSTRUCTIONS}

Respond with a JSON array only, no markdown. Each item:
{"text": "Would you listen to a podcast about how octopuses taste the world by licking their arms?", "topic": "how octopuses taste the world by licking their arms", "tagSlugs": ["slug1"], "category": "parent-slug"}`;

  try {
    const resolved = await resolveAiProvider(userId);
    let responseText: string;
    const llmStart = Date.now();

    const anthropicApiKey = resolved.apiKey || process.env.ANTHROPIC_API_KEY;
    if (anthropicApiKey) {
      // Use Anthropic SDK with server-side web search tool
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: anthropicApiKey });
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [{ role: 'user', content: systemPrompt }],
        tools: [WEB_SEARCH_TOOL],
      });
      responseText = response.content
        .filter(
          (block): block is Extract<(typeof response.content)[number], { type: 'text' }> =>
            block.type === 'text'
        )
        .map((block) => block.text)
        .join('\n\n');
    } else {
      // Use AI provider (claude-code CLI has built-in web search)
      const ai = createAIProvider(ctx.freeTierConfig.aiProvider);
      const result = await ai.generateResponse(
        systemPrompt,
        [{ role: 'user', content: `Generate ${requestCount} current-events questions.` }],
        { model: ctx.freeTierConfig.aiModel, maxTokens: 2048, temperature: 1.0 }
      );
      responseText = result.content;
    }

    const durationMs = Date.now() - llmStart;

    const questions = parseAndFilterQuestions(
      responseText, count, ctx.validSlugs, ctx.priorQuestionIds,
      { lenient: true }
    );

    // Fire-and-forget timing log
    prisma.apiUsageLog.create({
      data: {
        userId,
        service: 'anthropic',
        category: 'inspire_news',
        totalCost: 0,
        durationMs,
        metadata: {
          model: 'claude-haiku-4-5-20251001',
          questionCount: questions.length,
          topic: topic ?? null,
          timeRange,
        },
      },
    }).catch(() => {});

    return questions;
  } catch (err) {
    logger.warn('Failed to generate News questions', { error: (err as Error).message });
    return [];
  }
}
