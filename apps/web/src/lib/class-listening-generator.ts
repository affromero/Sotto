// Generates the LISTENING section of a class:
// 1. Creates a CLASS podcast seeded with due vocabulary.
// 2. Generates a short conversational script via generateScript().
// 3. Persists Script + VocabularyEntry rows (mirrors script-generation worker).
// 4. Queues audio generation via createSegmentsAndQueueAudio().
// 5. Upserts each generated vocab word into the learner's knowledge graph.
// 6. Generates comprehension MC questions over the transcript.
// 7. Creates the ClassSection + LessonQuestion rows (status: READY).
import { prisma } from './prisma';
import { resolveLearningAi } from './learning-ai';
import { createAIProvider } from './providers/ai';
import { loadAndRender } from './prompt-loader';
import { formatNotesForPrompt } from './course-notes';
import { generateScript } from './script-generator';
import { createSegmentsAndQueueAudio } from './segment-creator';
import { persistGeneratedReferences } from './references';
import { addJob, verifyClassReferencesQueue, JobType } from './queue';
import { getConfiguredTtsProviderId } from './providers/tts';
import { logUsage } from './usage-logger';
import { logger } from './logger';

const LISTENING_QUIZ_COUNT = 4;

export interface ClassListeningParams {
  userId: string;
  classId: string;
  courseId: string;
  level: string;
  nativeLang: string;
  targetLang: string;
  objective: string;
  mustIncludeVocab: Array<{ word: string; translation: string }>;
  note?: string;
  /** Optional sourced-class content + provenance (see ListeningContentParams). */
  sourceContent?: string;
  sourceMetadata?: { title?: string; author?: string; publishedDate?: string; siteName?: string };
  sourceUrl?: string;
}

export interface ClassListeningResult {
  sectionId: string;
  podcastId: string;
}

export interface ListeningComprehensionQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

// Content-only listening generation: builds the CLASS podcast (script → audio)
// and the comprehension questions, feeds generated vocab into the memory graph,
// and returns both. The caller decides where to persist the questions (a class
// section, or a practice session). No ClassSection/LessonQuestion rows here.
export interface ListeningContentParams {
  userId: string;
  courseId: string;
  level: string;
  nativeLang: string;
  targetLang: string;
  objective: string;
  mustIncludeVocab: Array<{ word: string; translation: string }>;
  /** Provenance for graph vocab (a class id). Undefined for practice sessions. */
  firstSeenClassId?: string;
  note?: string;
  /**
   * Optional sourced-class content: a CEFR-leveled passage in the target
   * language (from `prepareClassSource`). When present, the listening episode
   * derives from it with `[N]` citations and real, verified references.
   */
  sourceContent?: string;
  sourceMetadata?: { title?: string; author?: string; publishedDate?: string; siteName?: string };
  sourceUrl?: string;
}

export interface ListeningContent {
  podcastId: string;
  comprehensionQuestions: ListeningComprehensionQuestion[];
}

export async function composeListeningContent(p: ListeningContentParams): Promise<ListeningContent> {
  // Step 1: resolve the learning AI provider (BYOK or local agent)
  const ai = await resolveLearningAi(p.userId);

  // Step 2: create a CLASS podcast. When the instance pins an explicit TTS
  // provider (TTS_PROVIDER, e.g. the keyless local kokoro sidecar), seed it on
  // the podcast so the audio-generation worker renders listening audio with it.
  const podcast = await prisma.podcast.create({
    data: {
      userId: p.userId,
      title: `Listening: ${p.objective}`,
      topic: p.objective,
      source: 'CLASS',
      visibility: 'PRIVATE',
      language: p.targetLang,
      status: 'PENDING',
      ttsProvider: getConfiguredTtsProviderId() ?? undefined,
    },
  });
  const podcastId = podcast.id;

  try {
    // Step 3: generate the script
    const result = await generateScript({
      topic: p.objective,
      depth: 'standard',
      audienceLevel: p.level,
      focusAreas: [],
      tone: 'casual',
      durationTarget: 4,
      provider: ai.provider,
      model: ai.model,
      apiKeyOverride: ai.apiKey,
      source: 'CLASS',
      targetLanguage: p.targetLang,
      languageMode: 'conversational_mix',
      forLearning: true,
      mustIncludeVocabulary: p.mustIncludeVocab,
      sourceContent: p.sourceContent,
      sourceMetadata: p.sourceMetadata,
      // NOT key-availability fallback: web-search only enriches a topic that has
      // no extracted text; provider selection stays explicit (resolveLearningAi).
      webSearchEnabled: !p.sourceContent,
    });

    // Step 4: persist Script + VocabularyEntry (mirrors script-generation worker)
    await prisma.$transaction(async (tx) => {
      await tx.script.create({
        data: {
          podcastId,
          turns: result.turns,
          soundCues: result.soundCues.length > 0 ? result.soundCues : undefined,
          markdown: result.markdown,
        },
      });

      if (result.vocabulary && result.vocabulary.length > 0) {
        await tx.vocabularyEntry.createMany({
          data: result.vocabulary.map((v) => ({
            podcastId,
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

    // Step 4b: persist references, then enqueue the verify-ONLY worker. We do
    // NOT enqueue the reference-validation worker: for non-WEB/IMPORT sources it
    // re-runs createSegmentsAndQueueAudio (segment-creator is not idempotent),
    // which would double-create segments + double-queue audio.
    await persistGeneratedReferences(podcastId, result.references);
    if (result.references.length > 0) {
      await addJob(verifyClassReferencesQueue, JobType.VERIFY_CLASS_REFERENCES, { podcastId });
    }

    // Step 5: queue audio generation segments
    await createSegmentsAndQueueAudio(podcastId, result.turns);

    // Step 6: log usage
    logUsage({
      service: ai.provider,
      model: result.model,
      category: 'class-listening-script',
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      userId: p.userId,
      podcastId,
    });

    // Step 7: upsert generated vocab into the learner's knowledge graph
    for (const v of result.vocabulary ?? []) {
      if (!v.word) continue;
      await prisma.learnerVocab.upsert({
        where: { courseId_lemma: { courseId: p.courseId, lemma: v.word } },
        create: {
          courseId: p.courseId,
          lemma: v.word,
          translation: v.translation,
          partOfSpeech: v.partOfSpeech ?? null,
          pronunciation: v.pronunciation ?? null,
          firstSeenClassId: p.firstSeenClassId ?? null,
        },
        update: {},
      });
    }

    // Step 8: build transcript for quiz generation
    const transcript = result.turns.map((t) => `${t.speaker}: ${t.text}`).join('\n');

    // Step 9: generate comprehension questions
    const systemPrompt = loadAndRender('class/generate-listening-quiz.md', {
      COUNT: String(LISTENING_QUIZ_COUNT),
      LEVEL: p.level,
      NATIVE: p.nativeLang,
      TARGET: p.targetLang,
      TRANSCRIPT: transcript,
      NOTES: formatNotesForPrompt(p.note ?? ''),
    });

    const provider = createAIProvider(ai.provider);
    const quizResponse = await provider.generateResponse(
      systemPrompt,
      [{ role: 'user', content: `Generate ${LISTENING_QUIZ_COUNT} listening comprehension questions.` }],
      { model: ai.model, apiKeyOverride: ai.apiKey, maxTokens: 4096, temperature: 0.7 },
    );

    logUsage({
      service: ai.provider,
      model: quizResponse.model,
      category: 'class-listening-quiz',
      inputTokens: quizResponse.inputTokens,
      outputTokens: quizResponse.outputTokens,
      userId: p.userId,
      podcastId,
    });

    // Step 10: parse quiz JSON
    const cleaned = quizResponse.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    let rawQuestions: Array<{ question: string; options: unknown[]; correctIndex: unknown; explanation: string }>;
    try {
      rawQuestions = JSON.parse(cleaned);
    } catch (err) {
      logger.error('Failed to parse listening-quiz LLM response', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw new Error('Listening quiz generation returned malformed output.');
    }

    const questions = rawQuestions
      .filter(
        (q) =>
          typeof q.question === 'string' &&
          Array.isArray(q.options) &&
          q.options.length === 4 &&
          typeof q.correctIndex === 'number',
      )
      .slice(0, LISTENING_QUIZ_COUNT)
      .map((q) => ({
        question: q.question,
        options: (q.options as string[]).slice(0, 4),
        correctIndex: Math.max(0, Math.min(3, q.correctIndex as number)),
        explanation: typeof q.explanation === 'string' ? q.explanation : '',
      }));

    if (questions.length === 0) {
      throw new Error('Listening quiz generation produced no usable questions.');
    }

    return { podcastId, comprehensionQuestions: questions };
  } catch (err) {
    // Best-effort cleanup: mark the podcast failed so it doesn't linger as PENDING.
    await prisma.podcast.update({ where: { id: podcastId }, data: { status: 'FAILED' } }).catch(() => {});
    throw err;
  }
}

// Generate the LISTENING section of a class: compose the content, then persist
// the gated ClassSection + LessonQuestion rows.
export async function generateClassListening(p: ClassListeningParams): Promise<ClassListeningResult> {
  const { podcastId, comprehensionQuestions } = await composeListeningContent({
    userId: p.userId,
    courseId: p.courseId,
    level: p.level,
    nativeLang: p.nativeLang,
    targetLang: p.targetLang,
    objective: p.objective,
    mustIncludeVocab: p.mustIncludeVocab,
    firstSeenClassId: p.classId,
    note: p.note,
    sourceContent: p.sourceContent,
    sourceMetadata: p.sourceMetadata,
    sourceUrl: p.sourceUrl,
  });

  try {
    const section = await prisma.classSection.create({
      data: {
        classId: p.classId,
        skill: 'LISTENING',
        attempt: 1,
        seed: `${p.classId}-LISTENING-1`,
        spec: { objective: p.objective },
        status: 'READY',
        podcastId,
        generatedAt: new Date(),
      },
    });

    await prisma.lessonQuestion.createMany({
      data: comprehensionQuestions.map((q, i) => ({
        sectionId: section.id,
        order: i + 1,
        skill: 'LISTENING' as const,
        question: q.question,
        options: q.options,
        correctIndex: q.correctIndex,
        explanation: q.explanation,
      })),
    });

    logger.info('Listening section generated', {
      classId: p.classId,
      podcastId,
      sectionId: section.id,
      questionCount: String(comprehensionQuestions.length),
    });

    return { sectionId: section.id, podcastId };
  } catch (err) {
    // Best-effort cleanup: mark the podcast failed so it doesn't linger as PENDING.
    await prisma.podcast.update({ where: { id: podcastId }, data: { status: 'FAILED' } }).catch(() => {});
    throw err;
  }
}
