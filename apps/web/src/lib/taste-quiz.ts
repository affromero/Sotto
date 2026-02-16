import { createHash } from 'crypto';
import type { TasteQuestion } from '@sotto/shared';
import { prisma } from './prisma';
import { cache } from './redis';
import { getFreeTierConfig } from './free-tier-config';
import { createAIProvider } from './providers/ai';
import { resolveAiProvider } from './providers/ai';
import { WEB_SEARCH_TOOL } from './claude';
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
{"text": "Would you listen to a podcast about...?", "tagSlugs": ["slug1"], "category": "parent-slug"}`;

  const ai = createAIProvider(freeTierConfig.aiProvider);
  const response = await ai.generateResponse(
    systemPrompt,
    [{ role: 'user', content: `Generate ${requestCount} taste quiz questions.` }],
    { model: freeTierConfig.aiModel, maxTokens: 4096, temperature: 1.0 }
  );

  // Parse the JSON response
  let rawQuestions: Array<{ text: string; tagSlugs: string[]; category: string }>;
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
      tagSlugs: validTagSlugs,
      category: validSlugs.has(q.category) ? q.category : validTagSlugs[0],
    });

    if (questions.length >= count) break;
  }

  return questions;
}

interface InspireContext {
  taxonomyLines: string[];
  validSlugs: Set<string>;
  priorQuestionIds: Set<string>;
  freeTierConfig: { aiProvider: string; aiModel: string };
}

async function loadInspireContext(userId: string): Promise<InspireContext> {
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

function parseAndFilterQuestions(
  responseText: string,
  count: number,
  validSlugs: Set<string>,
  priorQuestionIds: Set<string>
): TasteQuestion[] {
  let rawQuestions: Array<{ text: string; tagSlugs: string[]; category: string }>;
  try {
    const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    rawQuestions = JSON.parse(jsonMatch[0]);
  } catch {
    return [];
  }

  if (!Array.isArray(rawQuestions)) return [];

  const questions: TasteQuestion[] = [];
  const seenIds = new Set<string>();

  for (const q of rawQuestions) {
    if (!q.text || !Array.isArray(q.tagSlugs) || q.tagSlugs.length === 0) continue;
    const id = hashQuestion(q.text);
    if (priorQuestionIds.has(id) || seenIds.has(id)) continue;
    const validTagSlugs = q.tagSlugs.filter((s: string) => validSlugs.has(s));
    if (validTagSlugs.length === 0) continue;
    seenIds.add(id);
    questions.push({
      id,
      text: q.text,
      tagSlugs: validTagSlugs,
      category: validSlugs.has(q.category) ? q.category : validTagSlugs[0],
    });
    if (questions.length >= count) break;
  }

  return questions;
}

/**
 * Generate interest-based "For You" questions. No web search — fast.
 * Combines user interests in unexpected ways, explores adjacent topics.
 * Falls back to diverse curiosity-driven questions when no interests exist.
 */
export async function generateForYouQuestions(
  userId: string,
  count: number
): Promise<TasteQuestion[]> {
  const cacheKey = `inspire:forYou:${userId}`;
  const cached = await cache.get<TasteQuestion[]>(cacheKey);
  if (cached) return cached;

  const [ctx, existingInterests] = await Promise.all([
    loadInspireContext(userId),
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

  const requestCount = count + 5;

  const systemPrompt = `You generate personalized podcast topic questions for Sotto's "For You" feed.

Each question should be a compelling yes/no prompt like "Would you listen to a podcast about...?" — specific enough that answering "yes" means the user wants a podcast created on that exact topic.

${interestContext}

Rules:
- Generate exactly ${requestCount} questions
- Each question maps to 1-3 existing tag slugs from the taxonomy
- Questions must be specific, vivid, and concrete — not generic
- Focus on CREATIVE COMBINATIONS and ADJACENT INTERESTS — not straightforward "more of what you like"
- Category is the parent slug the question belongs to

Taxonomy (parent: [children]):
${ctx.taxonomyLines.join('\n')}

Respond with a JSON array only, no markdown. Each item:
{"text": "Would you listen to a podcast about...?", "tagSlugs": ["slug1"], "category": "parent-slug"}`;

  try {
    const ai = createAIProvider(ctx.freeTierConfig.aiProvider);
    const result = await ai.generateResponse(
      systemPrompt,
      [{ role: 'user', content: `Generate ${requestCount} personalized inspire questions.` }],
      { model: ctx.freeTierConfig.aiModel, maxTokens: 2048, temperature: 1.0 }
    );

    const questions = parseAndFilterQuestions(
      result.content, count, ctx.validSlugs, ctx.priorQuestionIds
    );

    if (questions.length > 0) {
      await cache.set(cacheKey, questions, 3600);
    }

    return questions;
  } catch (err) {
    logger.warn('Failed to generate ForYou questions', { error: (err as Error).message });
    return [];
  }
}

/**
 * Generate current-events "In the News" questions using web search.
 * Must reference specific real events/people/dates from the past week.
 * Accepts excludeTopics to avoid overlap with ForYou questions.
 */
export async function generateNewsQuestions(
  userId: string,
  count: number,
  excludeTopics: string[] = []
): Promise<TasteQuestion[]> {
  const cacheKey = `inspire:news:${userId}`;
  const cached = await cache.get<TasteQuestion[]>(cacheKey);
  if (cached) return cached;

  const ctx = await loadInspireContext(userId);

  const excludeContext = excludeTopics.length > 0
    ? `\n\nIMPORTANT: The following topics are already shown in a different tab. Do NOT generate questions about similar subjects:\n${excludeTopics.map((t) => `- ${t}`).join('\n')}`
    : '';

  const requestCount = count + 5;

  const systemPrompt = `You generate current-events podcast topic questions for Sotto's "In the News" feed.

Search the web for the most notable events, breakthroughs, controversies, and developments from THE PAST WEEK. Each question MUST be grounded in a specific, real, verifiable event.

Rules:
- Generate exactly ${requestCount} questions
- Each question MUST reference a specific real event, person, date, or development from this week
- Each question maps to 1-3 existing tag slugs from the taxonomy
- Questions must feel timely and urgent — "Would you listen to a podcast about [specific thing that just happened]?"
- Include the "why now" — what makes this newsworthy this week specifically
- Category is the parent slug the question belongs to
- Cover diverse topics: science, politics, tech, business, culture, sports${excludeContext}

Taxonomy (parent: [children]):
${ctx.taxonomyLines.join('\n')}

Respond with a JSON array only, no markdown. Each item:
{"text": "Would you listen to a podcast about...?", "tagSlugs": ["slug1"], "category": "parent-slug"}`;

  try {
    const resolved = await resolveAiProvider(userId);
    let responseText: string;

    if (resolved.provider === 'anthropic' || resolved.source === 'platform') {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const apiKey = resolved.apiKey || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return [];
      const client = new Anthropic({ apiKey });
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [{ role: 'user', content: systemPrompt }],
        tools: [WEB_SEARCH_TOOL],
      });
      const textBlock = response.content.find((block) => block.type === 'text');
      responseText = textBlock && textBlock.type === 'text' ? textBlock.text : '';
    } else {
      const ai = createAIProvider(ctx.freeTierConfig.aiProvider);
      const result = await ai.generateResponse(
        systemPrompt,
        [{ role: 'user', content: `Generate ${requestCount} current-events questions.` }],
        { model: ctx.freeTierConfig.aiModel, maxTokens: 2048, temperature: 1.0 }
      );
      responseText = result.content;
    }

    const questions = parseAndFilterQuestions(
      responseText, count, ctx.validSlugs, ctx.priorQuestionIds
    );

    if (questions.length > 0) {
      await cache.set(cacheKey, questions, 3600);
    }

    return questions;
  } catch (err) {
    logger.warn('Failed to generate News questions', { error: (err as Error).message });
    return [];
  }
}
