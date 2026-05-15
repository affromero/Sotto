import { Job } from 'bullmq';
import type { GenerateQuizPayload } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { createAIProvider } from '@/lib/providers/ai';
import { getAiKey } from '@/lib/byok';
import { resolveAiModelAndProvider, type AiProviderId } from '@/lib/providers/ai-registry';
import { loadAndRender } from '@/lib/prompt-loader';
import { logUsage } from '@/lib/usage-logger';
import { logger } from '@/lib/logger';

interface QuizQuestionData {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  turnIndex?: number;
}

export async function processQuizGeneration(job: Job<GenerateQuizPayload>): Promise<void> {
  const { podcastId } = job.data;
  await job.updateProgress(10);

  // Guard: skip if quiz already exists and is READY
  const existing = await prisma.podcastQuiz.findUnique({
    where: { podcastId },
    select: { status: true },
  });
  if (existing?.status === 'READY') {
    logger.info('Quiz already exists for podcast, skipping', { podcastId });
    await job.updateProgress(100);
    return;
  }

  // Load script
  const script = await prisma.script.findUnique({
    where: { podcastId },
    select: { turns: true, context: true },
  });
  if (!script) {
    logger.warn('No script found for quiz generation, skipping', { podcastId });
    await job.updateProgress(100);
    return;
  }

  const turns = script.turns as Array<{ speaker: string; text: string }>;
  if (turns.length < 5) {
    logger.info('Script too short for quiz generation', { podcastId, turnCount: turns.length });
    await job.updateProgress(100);
    return;
  }

  // Delete existing quiz if re-generating (e.g. podcast was re-generated)
  if (existing) {
    await prisma.podcastQuiz.delete({ where: { podcastId } });
  }

  // Create quiz record
  const quiz = await prisma.podcastQuiz.create({
    data: { podcastId, status: 'GENERATING' },
  });

  await job.updateProgress(30);

  try {
    const podcast = await prisma.podcast.findUniqueOrThrow({
      where: { id: podcastId },
      select: {
        userId: true,
        aiModel: true,
        user: { select: { plan: true } },
      },
    });

    const initialAiKey = podcast.aiModel ? null : await getAiKey(podcast.userId);
    if (!podcast.aiModel && !initialAiKey) {
      throw new Error('AI model is required for quiz generation when no AI key is configured.');
    }

    const { model, provider } = await resolveAiModelAndProvider({
      podcastAiModel: podcast.aiModel,
      aiKey: initialAiKey,
      plan: podcast.user.plan as 'FREE' | 'PRO',
    });

    const providerAiKey =
      podcast.aiModel && provider !== 'claude-code'
        ? await getAiKey(podcast.userId, provider as AiProviderId)
        : initialAiKey;

    // Fetch vocabulary entries for language learning podcasts
    const vocabularyEntries = await prisma.vocabularyEntry.findMany({
      where: { podcastId },
      orderBy: { number: 'asc' },
      select: { word: true, translation: true, partOfSpeech: true },
    });

    const questionCount = turns.length < 10 ? 3 : turns.length < 20 ? 4 : 5;
    const mediumCount = questionCount - 2; // 1 easy + N medium + 1 hard

    const scriptTurns = turns
      .map((t, i) => `[${i}] ${t.speaker}: ${t.text}`)
      .join('\n');

    const vocabularySection = vocabularyEntries.length > 0
      ? `\n\nThe podcast taught these vocabulary words:\n${vocabularyEntries.map((v) => `- ${v.word} (${v.translation}${v.partOfSpeech ? `, ${v.partOfSpeech}` : ''})`).join('\n')}\n\nInclude 1-2 questions testing vocabulary knowledge (e.g. "What does [word] mean?" or "Which word means [translation]?").`
      : '';

    const prompt = loadAndRender('quiz/generate-quiz.md', {
      QUESTION_COUNT: String(questionCount),
      MEDIUM_COUNT: String(mediumCount),
      SCRIPT_TURNS: scriptTurns,
      SCRIPT_CONTEXT: ((script.context as string) || 'No additional context available.') + vocabularySection,
    });

    await job.updateProgress(50);

    // Call LLM
    const ai = createAIProvider(provider);
    const response = await ai.generateResponse(
      'You are a quiz generation assistant. Return only valid JSON.',
      [{ role: 'user', content: prompt }],
      { model, apiKeyOverride: providerAiKey?.apiKey },
    );

    await job.updateProgress(70);

    // Parse response
    const text = response.content.trim();
    const jsonStr = text.startsWith('[') ? text : text.match(/\[[\s\S]*\]/)?.[0];
    if (!jsonStr) {
      throw new Error('Failed to extract JSON array from LLM response');
    }
    const questions: QuizQuestionData[] = JSON.parse(jsonStr);

    if (!Array.isArray(questions) || questions.length === 0) {
      throw new Error('LLM returned empty or invalid questions array');
    }

    // Create questions
    await prisma.$transaction(
      questions.map((q, i) =>
        prisma.quizQuestion.create({
          data: {
            quizId: quiz.id,
            order: i,
            question: q.question,
            options: q.options,
            correctIndex: q.correctIndex,
            explanation: q.explanation,
            turnIndex: q.turnIndex ?? null,
          },
        }),
      ),
    );

    // Mark quiz as READY
    await prisma.podcastQuiz.update({
      where: { id: quiz.id },
      data: { status: 'READY', model, provider },
    });

    await logUsage({
      service: provider,
      model: response.model,
      category: 'quiz-generation',
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      podcastId,
    });

    logger.info('Quiz generated successfully', {
      podcastId,
      quizId: quiz.id,
      questionCount: questions.length,
    });
  } catch (error) {
    logger.error('Quiz generation failed', {
      podcastId,
      quizId: quiz.id,
      error: error instanceof Error ? error.message : String(error),
    });

    await prisma.podcastQuiz.update({
      where: { id: quiz.id },
      data: { status: 'FAILED' },
    });
  }

  await job.updateProgress(100);
}
