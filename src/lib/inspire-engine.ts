import Anthropic from '@anthropic-ai/sdk';
import { prisma } from './prisma';
import { cache } from './redis';
import { getTrending } from './recommendation-engine';
import { logger } from './logger';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
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
 * Get personalized topic suggestions based on user interests.
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

  if (!ANTHROPIC_API_KEY) {
    const fallback = tagNames.map((name) => ({
      title: `Deep dive into ${name}`,
      category: name,
      hook: `Explore the latest developments in ${name.toLowerCase()}`,
    }));
    return fallback;
  }

  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `Suggest 4 specific, compelling podcast topics based on these interests: ${tagNames.join(', ')}.

Return ONLY a JSON array with this format:
[{"title": "short topic title", "category": "interest area", "hook": "one engaging sentence description"}]

Make topics specific and current, not generic. Each should be a concrete topic someone could learn about.`,
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') return getGenericForYouTopics();

    const jsonMatch = textBlock.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return getGenericForYouTopics();

    const topics: TopicSuggestion[] = JSON.parse(jsonMatch[0]);
    await cache.set(cacheKey, topics, CACHE_TTL_SECONDS);
    return topics;
  } catch (err) {
    logger.warn('Failed to generate personalized topics', { error: (err as Error).message });
    return getGenericForYouTopics();
  }
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
 * Get current events using Claude with web search.
 * Falls back to generated topic ideas if web search fails.
 */
export async function getCurrentEvents(interests?: string[]): Promise<TopicSuggestion[]> {
  const interestKey = interests?.sort().join(',') ?? 'general';
  const cacheKey = `inspire:news:${interestKey}`;
  const cached = await cache.get<TopicSuggestion[]>(cacheKey);
  if (cached) return cached;

  if (!ANTHROPIC_API_KEY) {
    return getGenericNewsSuggestions();
  }

  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    const interestContext =
      interests && interests.length > 0
        ? `related to: ${interests.join(', ')}`
        : 'across science, technology, business, and culture';

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      tools: [{ type: 'web_search_20250305' as const, name: 'web_search' as const }],
      messages: [
        {
          role: 'user',
          content: `Find 3-4 notable current events or trending topics from the past week ${interestContext} that would make great podcast topics.

Return ONLY a JSON array:
[{"title": "short topic title", "category": "area", "hook": "one-sentence description of why this is interesting now"}]`,
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') return getGenericNewsSuggestions();

    const jsonMatch = textBlock.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return getGenericNewsSuggestions();

    const topics: TopicSuggestion[] = JSON.parse(jsonMatch[0]);
    await cache.set(cacheKey, topics, CACHE_TTL_SECONDS);
    return topics;
  } catch (err) {
    logger.warn('Failed to get current events via web search', {
      error: (err as Error).message,
    });
    return getGenericNewsSuggestions();
  }
}

/**
 * Drill down into a broad category to get specific subtopics.
 */
export async function drillDown(
  category: string,
  parentTitle?: string
): Promise<TopicSuggestion[]> {
  if (!ANTHROPIC_API_KEY) {
    return [
      { title: `${category}: Beginner's Guide`, category, hook: 'Start from the fundamentals' },
      { title: `${category}: Latest Breakthroughs`, category, hook: 'What happened this year' },
      { title: `${category}: Controversies`, category, hook: 'The debates that matter' },
      {
        title: `${category}: Future Predictions`,
        category,
        hook: 'Where experts think this is heading',
      },
    ];
  }

  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const context = parentTitle
      ? `The user tapped on "${parentTitle}" in the "${category}" category.`
      : `The user wants to explore "${category}".`;

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `${context}

Suggest 5 specific podcast topics within this area. Each should be concrete enough to generate a focused 5-10 minute podcast.

Return ONLY a JSON array:
[{"title": "specific topic title", "category": "${category}", "hook": "one engaging sentence"}]`,
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') return [];

    const jsonMatch = textBlock.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    logger.warn('Failed to drill down topics', { error: (err as Error).message });
    return [];
  }
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
