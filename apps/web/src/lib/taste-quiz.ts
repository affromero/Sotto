import { createHash } from 'crypto';
import type { TasteQuestion } from '@sotto/shared';
import { prisma } from './prisma';
import { createAIProvider } from './providers/ai';
import { getAiProviderMeta, getProviderForModel, type AiProviderId } from './providers/ai-registry';
import { getAiKey } from './byok';
import { loadAndRender } from './prompt-loader';
import { logUsage } from './usage-logger';
import { logger } from './logger';

const LOCAL_AI_PROVIDER: AiProviderId = 'claude-code';
const LOCAL_MODEL_PREFIX = 'claude-code:';

interface ResolvedTasteAiProvider {
  provider: AiProviderId;
  source: 'byok' | 'local';
  apiKey?: string;
  model: string;
}

function hashQuestion(text: string): string {
  return createHash('sha256').update(text.toLowerCase().trim()).digest('hex').slice(0, 12);
}

function providerForTasteModel(model: string): AiProviderId | null {
  if (model.startsWith(LOCAL_MODEL_PREFIX) && model.length > LOCAL_MODEL_PREFIX.length) {
    return LOCAL_AI_PROVIDER;
  }
  return getProviderForModel(model);
}

async function resolveTasteAiProvider(
  userId: string,
  explicitModel?: string,
): Promise<ResolvedTasteAiProvider> {
  if (explicitModel) {
    const provider = providerForTasteModel(explicitModel);
    if (!provider) {
      throw new Error(`Unknown AI model: ${explicitModel}`);
    }

    if (provider === LOCAL_AI_PROVIDER) {
      return { provider, source: 'local', model: explicitModel };
    }

    const providerKey = await getAiKey(userId, provider);
    if (!providerKey) {
      throw new Error(`AI key for provider "${provider}" is required for taste quiz generation.`);
    }

    return {
      provider,
      source: 'byok',
      apiKey: providerKey.apiKey,
      model: explicitModel,
    };
  }

  const aiKey = await getAiKey(userId);
  if (!aiKey) {
    throw new Error('AI key or explicit local AI model is required for taste quiz generation.');
  }

  const model = getAiProviderMeta(aiKey.provider).defaultModel;
  if (!model) {
    throw new Error(`No default AI model configured for provider "${aiKey.provider}".`);
  }

  return {
    provider: aiKey.provider,
    source: 'byok',
    apiKey: aiKey.apiKey,
    model,
  };
}

/**
 * Generate fresh taste quiz questions for a user using their configured AI key.
 * Questions are unique per user — previously answered questions are filtered out.
 */
export async function generateQuestions(
  userId: string,
  count: number
): Promise<TasteQuestion[]> {
  // Fetch taxonomy, user context, and prior answers in parallel
  const [categories, existingInterests, priorAnswers, aiConfig] = await Promise.all([
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
    resolveTasteAiProvider(userId),
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

  const ai = createAIProvider(aiConfig.provider);
  const response = await ai.generateResponse(
    systemPrompt,
    [{ role: 'user', content: `Generate ${requestCount} taste quiz questions.` }],
    { model: aiConfig.model, apiKeyOverride: aiConfig.apiKey, maxTokens: 4096, temperature: 1.0 }
  );

  logUsage({
    service: aiConfig.provider,
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

