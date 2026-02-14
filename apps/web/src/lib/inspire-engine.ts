import { prisma } from './prisma';
import { cache } from './redis';
import { getTrending } from './recommendation-engine';
import { logger } from './logger';
import { resolveAiProvider } from './providers/ai';
import type { ResolvedAiProvider } from './providers/ai';

const CACHE_TTL_SECONDS = 3600; // 1 hour

export interface TopicSuggestion {
  title: string;
  category: string;
  hook: string;
  icon?: string;
}

export interface InspireResult {
  forYou: TopicSuggestion[];
  trending: TopicSuggestion[];
  inTheNews: TopicSuggestion[];
}

/**
 * Central helper that resolves the AI provider for a user and generates topics.
 * Handles BYOK keys, platform keys, claude-code dev mode, and OpenAI.
 */
async function generateTopics(
  userId: string,
  prompt: string,
  opts: { webSearch?: boolean; fallback: () => TopicSuggestion[]; cacheKey?: string }
): Promise<TopicSuggestion[]> {
  let resolved: ResolvedAiProvider;
  try {
    resolved = await resolveAiProvider(userId);
  } catch {
    return opts.fallback();
  }

  try {
    let responseText: string;

    if (resolved.source === 'claude-code') {
      const { executeClaudeCode } = await import('./claude-code-client');
      const result = await executeClaudeCode('', prompt, { model: 'opus' });
      responseText = result.content;
    } else if (resolved.provider === 'anthropic') {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const apiKey = resolved.apiKey || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return opts.fallback();
      const client = new Anthropic({ apiKey });

      const messages = [{ role: 'user' as const, content: prompt }];
      const tools = opts.webSearch
        ? [{ type: 'web_search_20250305' as const, name: 'web_search' as const }]
        : undefined;

      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages,
        ...(tools ? { tools } : {}),
      });

      const textBlock = response.content.find((block) => block.type === 'text');
      if (!textBlock || textBlock.type !== 'text') return opts.fallback();
      responseText = textBlock.text;
    } else if (resolved.provider === 'openai') {
      const { default: OpenAI } = await import('openai');
      const openaiKey = resolved.apiKey || process.env.OPENAI_API_KEY;
      if (!openaiKey) return opts.fallback();
      const client = new OpenAI({ apiKey: openaiKey });

      const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      });

      responseText = response.choices[0]?.message?.content || '';
    } else {
      return opts.fallback();
    }

    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return opts.fallback();

    const topics: TopicSuggestion[] = JSON.parse(jsonMatch[0]);

    if (opts.cacheKey) {
      await cache.set(opts.cacheKey, topics, CACHE_TTL_SECONDS);
    }

    return topics;
  } catch (err) {
    logger.warn('Failed to generate topics', { error: (err as Error).message });
    return opts.fallback();
  }
}

/**
 * Get personalized topic suggestions based on user interests.
 * Uses web search to ground topics in real current events.
 * Falls back to popular topics if user has no interests.
 */
export async function getPersonalizedTopics(userId: string): Promise<TopicSuggestion[]> {
  const interests = await prisma.userInterest.findMany({
    where: { userId },
    include: { tag: { select: { name: true, slug: true } } },
    orderBy: { weight: 'desc' },
    take: 6,
  });

  if (interests.length === 0) {
    return getGenericForYouTopics();
  }

  const cacheKey = `inspire:foryou:${userId}`;
  const cached = await cache.get<TopicSuggestion[]>(cacheKey);
  if (cached) return cached;

  const tagNames = interests.map((i) => i.tag.name);

  const fallback = () =>
    tagNames.map((name) => ({
      title: `Deep dive into ${name}`,
      category: name,
      hook: `Explore the latest developments in ${name.toLowerCase()}`,
    }));

  const prompt = `Search for recent news, developments, and trending discussions related to: ${tagNames.join(', ')}.
Based on what's happening RIGHT NOW, suggest 4 specific podcast topics.
Each should be grounded in a real recent event, discovery, or debate — not generic evergreen content.

Return ONLY a JSON array with this format:
[{"title": "short topic title", "category": "interest area", "hook": "one engaging sentence description"}]

Make topics specific and current, not generic.`;

  return generateTopics(userId, prompt, { webSearch: true, fallback, cacheKey });
}

/**
 * Get trending topics from the platform's most popular podcasts.
 */
export async function getTrendingTopics(): Promise<TopicSuggestion[]> {
  const cacheKey = 'inspire:trending';
  const cached = await cache.get<TopicSuggestion[]>(cacheKey);
  if (cached) return cached;

  try {
    const trending = await getTrending();
    const topics = trending.slice(0, 4).map((p) => ({
      title: p.title,
      category: p.tags[0]?.name ?? 'Trending',
      hook: `${p.playCount} listens this week`,
    }));

    if (topics.length > 0) {
      await cache.set(cacheKey, topics, CACHE_TTL_SECONDS);
    }
    return topics;
  } catch (err) {
    logger.warn('Failed to get trending topics', { error: (err as Error).message });
    return [];
  }
}

/**
 * Get current events using AI with web search (Anthropic only).
 * Falls back to generated topic ideas if web search fails or provider unavailable.
 */
export async function getCurrentEvents(
  userId: string,
  interests?: string[]
): Promise<TopicSuggestion[]> {
  const interestKey = interests?.sort().join(',') ?? 'general';
  const cacheKey = `inspire:news:${interestKey}`;
  const cached = await cache.get<TopicSuggestion[]>(cacheKey);
  if (cached) return cached;

  const interestContext =
    interests && interests.length > 0
      ? `related to: ${interests.join(', ')}`
      : 'across science, technology, business, and culture';

  const prompt = `Find 3-4 notable current events or trending topics from the past week ${interestContext} that would make great podcast topics.

Return ONLY a JSON array:
[{"title": "short topic title", "category": "area", "hook": "one-sentence description of why this is interesting now"}]`;

  return generateTopics(userId, prompt, {
    webSearch: true,
    fallback: getGenericNewsSuggestions,
    cacheKey,
  });
}

/**
 * Drill down into a broad category to get specific subtopics.
 */
export async function drillDown(
  userId: string,
  category: string,
  parentTitle?: string
): Promise<TopicSuggestion[]> {
  const context = parentTitle
    ? `The user tapped on "${parentTitle}" in the "${category}" category.`
    : `The user wants to explore "${category}".`;

  const prompt = `${context}

Suggest 5 specific podcast topics within this area. Each should be concrete enough to generate a focused 5-10 minute podcast.

Return ONLY a JSON array:
[{"title": "specific topic title", "category": "${category}", "hook": "one engaging sentence"}]`;

  const fallback = () => [
    { title: `${category}: Beginner's Guide`, category, hook: 'Start from the fundamentals' },
    { title: `${category}: Latest Breakthroughs`, category, hook: 'What happened this year' },
    { title: `${category}: Controversies`, category, hook: 'The debates that matter' },
    {
      title: `${category}: Future Predictions`,
      category,
      hook: 'Where experts think this is heading',
    },
  ];

  return generateTopics(userId, prompt, { webSearch: false, fallback });
}

function getGenericForYouTopics(): TopicSuggestion[] {
  return [
    {
      title: 'How AI is Changing Creative Work',
      category: 'Technology',
      hook: 'From art to music to writing — AI tools are reshaping creation',
    },
    {
      title: 'The Science of Sleep',
      category: 'Science',
      hook: 'Why we dream and how sleep affects every part of life',
    },
    {
      title: 'History of Money',
      category: 'Economics',
      hook: 'From seashells to Bitcoin — how humans invented finance',
    },
    {
      title: 'Cognitive Biases That Shape Decisions',
      category: 'Psychology',
      hook: 'The hidden patterns that influence everything you choose',
    },
  ];
}

function getGenericNewsSuggestions(): TopicSuggestion[] {
  return [
    {
      title: 'Latest in Space Exploration',
      category: 'Science',
      hook: 'Recent missions and discoveries beyond Earth',
    },
    {
      title: 'AI Policy and Regulation',
      category: 'Technology',
      hook: 'How governments are responding to rapid AI advancement',
    },
    {
      title: 'Global Economic Trends',
      category: 'Economics',
      hook: 'Key shifts in markets and trade this year',
    },
  ];
}
