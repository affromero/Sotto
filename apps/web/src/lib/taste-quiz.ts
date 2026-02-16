import { createHash } from 'crypto';
import type { TasteQuestion } from '@sotto/shared';
import { prisma } from './prisma';
import { cache } from './redis';
import { getFreeTierConfig } from './free-tier-config';
import { createAIProvider } from './providers/ai';
import { resolveAiProvider } from './providers/ai';
import { getTrending } from './recommendation-engine';
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

type InspireSection = 'forYou' | 'trending' | 'news';

/**
 * Generate quiz-format questions for the Inspire Me overlay.
 * Reuses the same taxonomy, slug validation, hash dedup, and prior-answer filtering.
 */
export async function generateInspireQuestions(
  userId: string,
  count: number,
  section: InspireSection
): Promise<TasteQuestion[]> {
  const cacheKey = `inspire:questions:${section}:${userId}`;
  const cached = await cache.get<TasteQuestion[]>(cacheKey);
  if (cached) return cached;

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
      select: { tag: { select: { name: true, slug: true } }, weight: true },
    }),
    prisma.tasteQuizAnswer.findMany({
      where: { userId },
      select: { questionId: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    getFreeTierConfig(),
  ]);

  const priorQuestionIds = new Set(priorAnswers.map((a) => a.questionId));
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

  const interestNames = existingInterests
    .filter((i) => i.weight > 0)
    .map((i) => i.tag.name);

  let sectionContext: string;
  let useWebSearch = false;

  if (section === 'forYou') {
    sectionContext = interestNames.length > 0
      ? `The user is interested in: ${interestNames.join(', ')}. Generate questions tailored to their interests, combining topics they like in unexpected ways. Search the web for current events related to their interests.`
      : 'The user has no stated interests yet. Generate broadly appealing, curiosity-driven questions across diverse topics. Search the web for interesting current events.';
    useWebSearch = true;
  } else if (section === 'trending') {
    let trendingContext = '';
    try {
      const trending = await getTrending();
      if (trending.length > 0) {
        trendingContext = `Currently trending podcasts on the platform:\n${trending.slice(0, 8).map((p) => `- "${p.title}" (${p.playCount} plays)`).join('\n')}\n\nGenerate questions inspired by what's popular right now.`;
      }
    } catch {
      // Fall through to generic trending
    }
    sectionContext = trendingContext || 'Generate questions about topics that are broadly popular and trending in culture, tech, science, and current events.';
  } else {
    sectionContext = 'Search the web for the most notable current events and news from the past week. Generate questions about real, specific, timely topics — not evergreen content.';
    useWebSearch = true;
  }

  const requestCount = count + Math.min(priorAnswers.length, 5);

  const systemPrompt = `You generate podcast topic questions for Sotto's "Inspire Me" feature.

Each question should be a compelling yes/no prompt like "Would you listen to a podcast about...?" — specific enough that answering "yes" means the user wants a podcast created on that exact topic.

Context: ${sectionContext}

Rules:
- Generate exactly ${requestCount} questions
- Each question maps to 1-3 existing tag slugs from the taxonomy
- Questions must be specific, vivid, and concrete — not generic
- Category is the parent slug the question belongs to

Taxonomy (parent: [children]):
${taxonomyLines.join('\n')}

Respond with a JSON array only, no markdown. Each item:
{"text": "Would you listen to a podcast about...?", "tagSlugs": ["slug1"], "category": "parent-slug"}`;

  let responseText: string;
  try {
    if (useWebSearch) {
      // Use Anthropic directly for web search capability
      const resolved = await resolveAiProvider(userId);
      if (resolved.provider === 'anthropic' || resolved.source === 'platform') {
        const { default: Anthropic } = await import('@anthropic-ai/sdk');
        const apiKey = resolved.apiKey || process.env.ANTHROPIC_API_KEY;
        if (!apiKey) throw new Error('No API key');
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
        // Fallback: no web search
        const ai = createAIProvider(freeTierConfig.aiProvider);
        const result = await ai.generateResponse(
          systemPrompt,
          [{ role: 'user', content: `Generate ${requestCount} inspire questions.` }],
          { model: freeTierConfig.aiModel, maxTokens: 2048, temperature: 1.0 }
        );
        responseText = result.content;
      }
    } else {
      const ai = createAIProvider(freeTierConfig.aiProvider);
      const result = await ai.generateResponse(
        systemPrompt,
        [{ role: 'user', content: `Generate ${requestCount} inspire questions.` }],
        { model: freeTierConfig.aiModel, maxTokens: 2048, temperature: 1.0 }
      );
      responseText = result.content;
    }
  } catch (err) {
    logger.warn('Failed to generate inspire questions', { error: (err as Error).message, section });
    return [];
  }

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

  if (questions.length > 0) {
    await cache.set(cacheKey, questions, 3600);
  }

  return questions;
}
