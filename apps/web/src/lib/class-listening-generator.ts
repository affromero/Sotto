// Review the generated listening script and quiz before persisting accepted
// script, vocabulary, and learner graph material. Verified references gate
// readiness; audio waits for the final learning association and questions.
import { learningScriptHash } from './learning/script-hash';
import { prisma } from './prisma';
import { capturedLearningAiOptions, resolveCapturedLearningAi } from './learning-ai';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { createAIProvider } from './providers/ai';
import { loadAndRender } from './prompt-loader';
import { formatNotesForPrompt } from './course-notes';
import { generateScript } from './script-generator';
import { createSegmentsAndQueueAudio } from './segment-creator';
import { cleanTextForTts } from './tts-text-cleaner';
import { persistGeneratedReferences } from './references';
import { getConfiguredTtsProviderId, resolveTtsProvider } from './providers/tts';
import { getServerInfra } from './server-config';
import { logUsage } from './usage-logger';
import { logger } from './logger';
import { classLanguagePolicy, isImmersionLevel } from './classes/class-language-policy';
import { verifyEpisodeReferences } from './reference-verification/verify-episode';
import { z } from 'zod';
import {
  reviewTeachingContent,
  TeachingQualityRejectionError,
} from './classes/quality/teaching-quality';
import { combineTeachingFailures, type TeachingFailure } from './classes/quality/teaching-failure';
import {
  assertClassGeneration,
  withClassGeneration,
} from './learning/classes/class-generation-state';
import {
  SECTION_QUALITY_JSON_SCHEMA,
  sectionReviewInput,
  assessSectionReview,
  SectionQualityError,
  captureBlindSectionFailure,
} from './classes/section-quality';

const LISTENING_QUIZ_COUNT = 4;
const listeningQuizSchema = z
  .array(
    z
      .object({
        question: z.string().trim().min(1),
        options: z.array(z.string().trim().min(1)).length(4),
        correctIndex: z.number().int().min(0).max(3),
        explanation: z.string().trim().min(1),
      })
      .strict()
  )
  .length(LISTENING_QUIZ_COUNT);

export interface ClassListeningParams {
  ttsProvider?: import('./providers/tts-registry').TtsProviderId | null;
  /** Scheduled preparation leaves scripts for explicit learner review before audio spending. */
  deferAudio?: boolean;
  userId: string;
  execution: SottoProviderExecution;
  classId: string;
  courseId: string;
  attempt?: number;
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
  episodeId: string;
}

interface ListeningComprehensionQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

// Content-only listening generation: builds the CLASS episode and script
// and the comprehension questions, feeds generated vocab into the memory graph,
// and returns both. The caller decides where to persist the questions (a class
// section, or a practice session). No ClassSection/LessonQuestion rows here.
export interface ListeningContentParams {
  ttsProvider?: import('./providers/tts-registry').TtsProviderId | null;
  deferAudio?: boolean;
  userId: string;
  execution: SottoProviderExecution;
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
  episodeId: string;
  comprehensionQuestions: ListeningComprehensionQuestion[];
  turns: Array<{ speaker: string; text: string; direction?: string }>;
}

/** Admit audio only after the caller has persisted the final learning association. */
export async function queueListeningAudio(
  content: ListeningContent,
  execution: SottoProviderExecution,
  classAttempt?: { classId: string; attempt: number }
) {
  const registerAudioEpisode = execution.registerAudioEpisode;
  await createSegmentsAndQueueAudio(content.episodeId, content.turns, {
    authorize: execution.authorize,
    onPrepared: async (database, audioGenerationKey) => {
      if (classAttempt)
        await assertClassGeneration(
          database,
          classAttempt.classId,
          classAttempt.attempt,
          execution.userId
        );
      await registerAudioEpisode?.(database, content.episodeId, audioGenerationKey);
    },
  });
}

/**
 * How many of a class's references must verify for the class to ship.
 *
 * A simple majority, and never fewer than one. The reasoning: a class whose
 * sources are mostly sound is still worth listening to — the failed entries are
 * shown as failed — while one where half or more of the citations cannot be
 * stood up is not something to teach from, however much was spent generating
 * it. Deliberately not reusing `getMinReferenceCount`: that governs how many
 * references a script must *contain*, which is a question about depth and
 * duration, not about how many of them survived checking.
 */
export function minimumVerifiedReferences(total: number): number {
  if (total <= 0) return 0;
  return Math.max(1, Math.ceil(total / 2));
}

export async function composeListeningContent(
  p: ListeningContentParams
): Promise<ListeningContent> {
  // Step 1: resolve the learning AI provider (BYOK or local agent)
  const ai = await resolveCapturedLearningAi(p.userId, p.execution);
  const userSpeechPrefs = await prisma.user.findUnique({
    where: { id: p.userId },
    select: { preferredTtsModel: true },
  });
  await getServerInfra();
  const configuredTtsProvider =
    p.ttsProvider === undefined ? getConfiguredTtsProviderId() : p.ttsProvider;
  if (!p.deferAudio && !configuredTtsProvider) {
    throw new Error(
      'AI audio is not enabled. Select a speech provider in Settings before starting listening practice.'
    );
  }
  const resolvedTts = p.deferAudio
    ? null
    : await resolveTtsProvider({
        userId: p.userId,
        execution: p.execution,
        episodeId: p.firstSeenClassId ?? p.courseId,
        requestedProvider: configuredTtsProvider,
        requestedModel: userSpeechPrefs?.preferredTtsModel,
        language: p.targetLang,
      });

  // Step 2: create a CLASS episode. When the instance pins a TTS provider,
  // such as the keyless local Kokoro sidecar, seed it on
  // the episode so the audio-generation worker renders listening audio with it.
  const episode = await prisma.episode.create({
    data: {
      userId: p.userId,
      title: `Listening: ${p.objective}`,
      topic: p.objective,
      source: 'CLASS',
      visibility: 'PRIVATE',
      language: p.targetLang,
      status: 'PENDING',
      ttsProvider: resolvedTts?.providerId ?? configuredTtsProvider ?? undefined,
      ttsModel:
        resolvedTts?.provider.getModelId() ?? userSpeechPrefs?.preferredTtsModel ?? undefined,
    },
  });
  const episodeId = episode.id;

  try {
    let learningRepair: Parameters<typeof generateScript>[0]['learningRepair'];
    let priorBlindFailure: TeachingFailure | undefined;
    let accepted:
      | {
          result: Awaited<ReturnType<typeof generateScript>>;
          questions: z.infer<typeof listeningQuizSchema>;
        }
      | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      // Step 3: generate the script
      const result = await generateScript({
        learningRepair,
        ...(await capturedLearningAiOptions(ai)),
        topic: p.objective,
        depth: 'standard',
        audienceLevel: p.level,
        focusAreas: [],
        tone: 'casual',
        durationTarget: 4,
        provider: ai.provider,
        model: ai.model,
        apiKeyOverride: ai.apiKey,
        targetLanguage: p.targetLang,
        languageMode: isImmersionLevel(p.level) ? 'full_immersion' : 'conversational_mix',
        forLearning: true,
        mustIncludeVocabulary: p.mustIncludeVocab,
        sourceContent: p.sourceContent,
        sourceMetadata: p.sourceMetadata,
        // Web search enriches a topic that has no extracted text. Provider
        // selection stays explicit in resolveCapturedLearningAi.
        webSearchEnabled: !p.sourceContent,
      });

      // Step 6: log usage
      logUsage({
        service: ai.provider,
        model: result.model,
        category: 'class-listening-script',
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        userId: p.userId,
        episodeId,
      });

      // Step 8: build transcript for quiz generation
      const transcript = result.turns
        .map((turn) => `${turn.speaker}: ${cleanTextForTts(turn.text)}`)
        .join('\n');

      // Step 9: generate comprehension questions
      const systemPrompt = loadAndRender('class/generate-listening-quiz.md', {
        COUNT: String(LISTENING_QUIZ_COUNT),
        LEVEL: p.level,
        NATIVE: p.nativeLang,
        TARGET: p.targetLang,
        LANGUAGE_POLICY: classLanguagePolicy({
          level: p.level,
          nativeLang: p.nativeLang,
          targetLang: p.targetLang,
        }),
        TRANSCRIPT: transcript,
        NOTES: formatNotesForPrompt(p.note ?? ''),
      });

      const provider = createAIProvider(ai.provider);
      const quizResponse = await provider.generateResponse(
        systemPrompt,
        [
          {
            role: 'user',
            content: `Generate ${LISTENING_QUIZ_COUNT} listening comprehension questions.`,
          },
        ],
        { ...(await capturedLearningAiOptions(ai)), maxTokens: 4096, temperature: 0.7 }
      );

      logUsage({
        service: ai.provider,
        model: quizResponse.model,
        category: 'class-listening-quiz',
        inputTokens: quizResponse.inputTokens,
        outputTokens: quizResponse.outputTokens,
        userId: p.userId,
        episodeId,
      });

      // Step 10: parse quiz JSON
      const cleaned = quizResponse.content
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      let rawQuestions: Array<{
        question: string;
        options: unknown[];
        correctIndex: unknown;
        explanation: string;
      }>;
      try {
        rawQuestions = JSON.parse(cleaned);
      } catch (err) {
        logger.error('Failed to parse listening-quiz LLM response', {
          error: err instanceof Error ? err.message : String(err),
        });
        throw new Error('Listening quiz generation returned malformed output.');
      }

      const parsedQuiz = listeningQuizSchema.safeParse(rawQuestions);
      if (!parsedQuiz.success)
        throw new Error('Listening quiz generation must produce all 4 valid questions.');
      const questions = parsedQuiz.data;
      const reviewedQuestions = questions.map((question) => ({
        ...question,
        passageText: transcript,
      }));
      const blindReview = await provider.generateResponse(
        loadAndRender('class/review-section-quiz.md', {
          LEVEL: p.level,
          TARGET: p.targetLang,
          NATIVE: p.nativeLang,
          SKILL: 'LISTENING',
          REVIEW_SCHEMA: JSON.stringify(SECTION_QUALITY_JSON_SCHEMA.schema),
          LANGUAGE_POLICY: classLanguagePolicy(p),
        }),
        [{ role: 'user', content: sectionReviewInput(reviewedQuestions) }],
        {
          ...(await capturedLearningAiOptions(ai)),
          temperature: 0,
          maxTokens: 2048,
          jsonSchema: SECTION_QUALITY_JSON_SCHEMA,
        }
      );
      logUsage({
        service: ai.provider,
        model: blindReview.model,
        category: 'class-listening-review',
        inputTokens: blindReview.inputTokens,
        outputTokens: blindReview.outputTokens,
        userId: p.userId,
        episodeId,
      });
      try {
        const assessment = assessSectionReview(
          blindReview.content,
          reviewedQuestions,
          true,
          'listening'
        );
        if (assessment.issues.length)
          throw new SectionQualityError(
            'Listening questions are not supported by the exact audio script.',
            assessment.feedback
              ? captureBlindSectionFailure(reviewedQuestions, assessment.feedback)
              : undefined,
            assessment.feedback
          );
      } catch (error) {
        if (
          !(error instanceof SectionQualityError) ||
          !error.blindReviewFeedback ||
          !error.blindReviewFailure
        )
          throw error;
        const evidence = combineTeachingFailures(priorBlindFailure, error.blindReviewFailure);
        if (attempt === 1)
          throw new SectionQualityError(error.message, evidence, error.blindReviewFeedback);
        priorBlindFailure = evidence;
        learningRepair = {
          candidate: {
            turns: result.turns,
            soundCues: result.soundCues,
            references: result.references,
            vocabulary: result.vocabulary,
            places: result.places,
          },
          questions,
          verdict: error.blindReviewFeedback,
        };
        continue;
      }

      try {
        await reviewTeachingContent({
          ai,
          provider,
          userId: p.userId,
          level: p.level,
          nativeLang: p.nativeLang,
          targetLang: p.targetLang,
          kind: 'listening',
          items: reviewedQuestions,
        });
      } catch (error) {
        if (error instanceof TeachingQualityRejectionError && priorBlindFailure)
          throw new TeachingQualityRejectionError(
            error.issues,
            error.feedback,
            combineTeachingFailures(priorBlindFailure, error.teachingFailure)
          );
        throw error;
      }

      accepted = { result, questions };
      break;
    }
    if (!accepted) throw new SectionQualityError();
    const { result, questions } = accepted;

    // Step 4: persist Script and VocabularyEntry
    await prisma.$transaction(async (tx) => {
      await tx.script.create({
        data: {
          episodeId,
          turns: result.turns,
          soundCues: result.soundCues.length > 0 ? result.soundCues : undefined,
          markdown: result.markdown,
        },
      });

      if (result.vocabulary && result.vocabulary.length > 0) {
        await tx.vocabularyEntry.createMany({
          data: result.vocabulary.map((v) => ({
            episodeId,
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

    // Step 4b: fail closed before spending money on audio — but only when the
    // sourcing is broadly unsound, not when a single citation is. Requiring
    // every reference to verify meant one model-invented DOI, or one real page
    // cited under a title that does not match its DOI, discarded a class whose
    // script had already been paid for. References that fail are kept and
    // carry a "Verification failed" badge in the player, so the learner sees
    // exactly which sources did not hold up rather than being handed a class
    // that silently claims all of them are sound. They are deliberately not
    // deleted: the citations in the script are numbered, so removing one would
    // leave a dangling [N] in the dialogue.
    await persistGeneratedReferences(episodeId, result.references);
    if (result.references.length > 0) {
      const referenceCheck = await verifyEpisodeReferences(
        episodeId,
        p.userId,
        p.objective,
        result.turns,
        p.execution
      );
      if (referenceCheck.verified < minimumVerifiedReferences(referenceCheck.total)) {
        throw new Error(
          `Class reference verification failed: only ${referenceCheck.verified} of ` +
            `${referenceCheck.total} sources could be verified`
        );
      }
    }

    // The caller attaches the class, practice, or exam before admitting audio.
    await prisma.episode.update({
      where: { id: episodeId },
      data: { status: 'SCRIPT_READY' },
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

    return { episodeId, comprehensionQuestions: questions, turns: result.turns };
  } catch (err) {
    // Best-effort cleanup: mark the episode failed so it doesn't linger as PENDING.
    await prisma.episode
      .update({ where: { id: episodeId }, data: { status: 'FAILED' } })
      .catch(() => {});
    throw err;
  }
}

// Generate the LISTENING section of a class: compose the content, then persist
// the gated ClassSection + LessonQuestion rows.
export async function generateClassListening(
  p: ClassListeningParams
): Promise<ClassListeningResult> {
  const attempt = p.attempt ?? 1;
  const content = await composeListeningContent({
    ttsProvider: p.ttsProvider,
    userId: p.userId,
    execution: p.execution,
    courseId: p.courseId,
    level: p.level,
    nativeLang: p.nativeLang,
    targetLang: p.targetLang,
    objective: p.objective,
    mustIncludeVocab: p.mustIncludeVocab,
    firstSeenClassId: p.classId,
    deferAudio: p.deferAudio,
    note: p.note,
    sourceContent: p.sourceContent,
    sourceMetadata: p.sourceMetadata,
    sourceUrl: p.sourceUrl,
  });
  const { episodeId, comprehensionQuestions } = content;

  try {
    const section = await withClassGeneration(p.execution, p.classId, attempt, async (database) => {
      const section = await database.classSection.create({
        data: {
          classId: p.classId,
          skill: 'LISTENING',
          attempt,
          seed: `${p.classId}-LISTENING-${attempt}`,
          spec: { objective: p.objective, scriptHash: learningScriptHash(content.turns) },
          status: 'READY',
          episodeId,
          generatedAt: new Date(),
        },
      });

      await database.lessonQuestion.createMany({
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
      return section;
    });

    if (!p.deferAudio)
      await queueListeningAudio(content, p.execution, { classId: p.classId, attempt });

    logger.info('Listening section generated', {
      classId: p.classId,
      episodeId,
      sectionId: section.id,
      questionCount: String(comprehensionQuestions.length),
    });

    return { sectionId: section.id, episodeId };
  } catch (err) {
    // Best-effort cleanup: mark the episode failed so it doesn't linger as PENDING.
    await prisma.episode
      .update({ where: { id: episodeId }, data: { status: 'FAILED' } })
      .catch(() => {});
    throw err;
  }
}
