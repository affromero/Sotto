/**
 * Pronunciation scorer — deterministic alignment + LLM rubric blend.
 *
 * Resolver: resolvePronunciationScorer(context)
 *   - 'self-contained' (default) → SelfContainedScorer
 *   - Future drop-ins: Azure Pronunciation Assessment, Speechace, etc.
 *
 * SelfContainedScorer pipeline:
 *   1. Needleman–Wunsch alignment (alignPhrase) for hard accuracy signal.
 *   2. Fluency proxy from wordTimings gaps (if present) or 0.7 neutral default.
 *   3. LLM rubric call ('speaking/pronunciation-rubric.md') for a blended
 *      { accuracy, fluency, completeness, feedback }.
 *   4. Average deterministic + LLM signals; overall = weighted mean.
 *   5. On LLM parse failure, fall back to pure deterministic scores — never throw.
 */

import { alignPhrase, type AlignedToken } from './align';
import { loadAndRender } from '../prompt-loader';
import { createAIProvider } from '../providers/ai';
import { logUsage } from '../usage-logger';
import { logger } from '../logger';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface PronunciationInput {
  /** The phrase the learner was asked to say. */
  targetPhrase: string;
  /** What the STT engine transcribed. */
  transcript: string;
  /** Per-word timing data from the STT engine (optional). */
  wordTimings?: Array<{ word: string; start: number; end: number }>;
  /** ISO 639-1 code of the target language (e.g. 'de', 'fr'). */
  targetLang: string;
  /** AI provider id for the rubric call (e.g. 'anthropic', 'openai'). */
  aiProvider: string;
  /** AI model id for the rubric call. */
  aiModel: string;
  /** Optional BYOK API key override. */
  aiApiKey?: string;
  /** Caller's user id — used for usage logging. */
  userId: string;
}

export interface RubricScores {
  /** Share of words produced correctly (0..1). */
  accuracy: number;
  /** Smoothness and naturalness of delivery (0..1). */
  fluency: number;
  /** Fraction of the target phrase the learner attempted (0..1). */
  completeness: number;
}

export interface PronunciationScore {
  /** Weighted overall score (accuracy×0.5 + fluency×0.25 + completeness×0.25), clamped 0..1. */
  overallScore: number;
  rubricScores: RubricScores;
  /** Short feedback string from the LLM (or deterministic fallback). */
  feedback: string;
  /** Per-token alignment operations from alignPhrase(). */
  phonemeScores: AlignedToken[];
  /** The raw STT transcript passed in. */
  transcript: string;
}

export interface PronunciationScorer {
  readonly id: string;
  score(input: PronunciationInput): Promise<PronunciationScore>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Compute a fluency proxy from word-level timings.
 *
 * Heuristic:
 *   - Expected speaking rate: 2–4 words per second for a short phrase.
 *   - We penalise long internal pauses (gaps between consecutive words > 1 s).
 *   - Final score = 1 − (penalised_gap_fraction), mapped to 0.5..1.0 so an
 *     otherwise fluent delivery with one long pause still gets a reasonable score.
 *
 * Returns 0.7 when no timings are available (neutral default).
 */
function computeFluency(
  timings: Array<{ word: string; start: number; end: number }> | undefined
): number {
  if (!timings || timings.length === 0) return 0.7;
  if (timings.length === 1) return 0.85; // single-word: can't measure internal gaps

  const sorted = [...timings].sort((a, b) => a.start - b.start);

  const LONG_PAUSE_THRESHOLD = 1.0; // seconds
  let longPauses = 0;
  let totalGaps = 0;

  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].start - sorted[i - 1].end;
    if (gap > 0) {
      totalGaps++;
      if (gap > LONG_PAUSE_THRESHOLD) longPauses++;
    }
  }

  const penaltyFraction = totalGaps > 0 ? longPauses / totalGaps : 0;
  // Map [0..1] penalty → [1.0..0.5] score
  return clamp01(1.0 - penaltyFraction * 0.5);
}

/**
 * Build a short human-readable alignment summary for the LLM prompt.
 * Example: "Matched 3/4 words. Substituted: 'anna'→'emma'. Missing: 'gut'."
 */
function buildAlignmentSummary(
  matched: number,
  expectedCount: number,
  substitutions: Array<{ expected?: string; actual?: string }>,
  deletions: string[]
): string {
  const parts: string[] = [`Matched ${matched}/${expectedCount} words.`];
  if (substitutions.length > 0) {
    const subs = substitutions.map((s) => `'${s.expected ?? '?'}'→'${s.actual ?? '?'}'`).join(', ');
    parts.push(`Substituted: ${subs}.`);
  }
  if (deletions.length > 0) {
    parts.push(`Missing: ${deletions.map((d) => `'${d}'`).join(', ')}.`);
  }
  return parts.join(' ');
}

interface LlmRubric {
  accuracy: number;
  fluency: number;
  completeness: number;
  feedback: string;
}

/**
 * Strip optional code fences and parse the LLM JSON response.
 * Returns null on any parse/validation failure — callers fall back gracefully.
 */
function parseLlmRubric(raw: string): LlmRubric | null {
  try {
    // Strip ```json ... ``` or ``` ... ``` wrappers
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    const parsed: unknown = JSON.parse(cleaned);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const obj = parsed as Record<string, unknown>;
    const accuracy = typeof obj['accuracy'] === 'number' ? obj['accuracy'] : null;
    const fluency = typeof obj['fluency'] === 'number' ? obj['fluency'] : null;
    const completeness = typeof obj['completeness'] === 'number' ? obj['completeness'] : null;
    const feedback = typeof obj['feedback'] === 'string' ? obj['feedback'] : null;

    if (accuracy === null || fluency === null || completeness === null || feedback === null) {
      return null;
    }

    return {
      accuracy: clamp01(accuracy),
      fluency: clamp01(fluency),
      completeness: clamp01(completeness),
      feedback,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// SelfContainedScorer
// ---------------------------------------------------------------------------

export class SelfContainedScorer implements PronunciationScorer {
  readonly id = 'self-contained';

  async score(input: PronunciationInput): Promise<PronunciationScore> {
    // Step 1 — deterministic alignment
    const alignment = alignPhrase(input.targetPhrase, input.transcript);

    // Step 2 — deterministic signals
    const deterministicAccuracy = alignment.accuracy;
    const deterministicFluency = computeFluency(input.wordTimings);

    // Completeness from alignment: words attempted (matched + substituted) / expected
    const attempted = alignment.matched + alignment.substitutions;
    const deterministicCompleteness =
      alignment.expectedCount === 0
        ? input.transcript.trim().length === 0
          ? 1
          : 0
        : clamp01(attempted / alignment.expectedCount);

    // Step 3 — LLM rubric
    const substitutionTokens = alignment.tokens.filter((t) => t.op === 'substitute');
    const deletionWords = alignment.tokens
      .filter((t) => t.op === 'delete')
      .map((t) => t.expected ?? '');

    const alignmentSummary = buildAlignmentSummary(
      alignment.matched,
      alignment.expectedCount,
      substitutionTokens,
      deletionWords
    );

    let llmRubric: LlmRubric | null = null;
    try {
      const systemPrompt = loadAndRender('speaking/pronunciation-rubric.md', {
        TARGET: input.targetLang,
        TARGET_PHRASE: input.targetPhrase,
        TRANSCRIPT: input.transcript,
        ALIGNMENT_SUMMARY: alignmentSummary,
      });

      const ai = createAIProvider(input.aiProvider);
      const res = await ai.generateResponse(
        systemPrompt,
        [{ role: 'user', content: 'Score this pronunciation attempt.' }],
        {
          model: input.aiModel,
          apiKeyOverride: input.aiApiKey,
          maxTokens: 256,
          temperature: 0.2,
          skipModeration: true,
        }
      );

      await logUsage({
        service: input.aiProvider,
        model: res.model,
        category: 'pronunciation-scoring',
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        userId: input.userId,
      });

      llmRubric = parseLlmRubric(res.content);
      if (!llmRubric) {
        logger.warn('[SelfContainedScorer] Failed to parse LLM rubric JSON, falling back', {
          raw: res.content.slice(0, 200),
        });
      }
    } catch (err) {
      logger.warn('[SelfContainedScorer] LLM rubric call failed, falling back to deterministic', {
        error: String(err),
      });
    }

    // Step 4 — blend deterministic + LLM signals
    let finalAccuracy: number;
    let finalFluency: number;
    let finalCompleteness: number;
    let feedback: string;

    if (llmRubric) {
      finalAccuracy = (deterministicAccuracy + llmRubric.accuracy) / 2;
      finalFluency = (deterministicFluency + llmRubric.fluency) / 2;
      finalCompleteness = (deterministicCompleteness + llmRubric.completeness) / 2;
      feedback = llmRubric.feedback;
    } else {
      finalAccuracy = deterministicAccuracy;
      finalFluency = deterministicFluency;
      finalCompleteness = deterministicCompleteness;
      feedback =
        deterministicAccuracy >= 0.9
          ? 'Great job! Keep practising to build fluency.'
          : 'Keep practising — focus on the words that were substituted or missing.';
    }

    // Step 5 — weighted overall score
    const overallScore = clamp01(
      finalAccuracy * 0.5 + finalFluency * 0.25 + finalCompleteness * 0.25
    );

    return {
      overallScore,
      rubricScores: {
        accuracy: clamp01(finalAccuracy),
        fluency: clamp01(finalFluency),
        completeness: clamp01(finalCompleteness),
      },
      feedback,
      phonemeScores: alignment.tokens,
      transcript: input.transcript,
    };
  }
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a PronunciationScorer by provider name.
 *
 * Supported values:
 *   - undefined / 'self-contained' → SelfContainedScorer (alignment + LLM blend)
 *
 * Future drop-ins via this resolver:
 *   - 'azure'       → Azure Pronunciation Assessment
 *   - 'speechace'   → Speechace API scorer
 *
 * Throws for any unrecognised value — no key-availability fallback.
 */
export function resolvePronunciationScorer(context: { provider?: string }): PronunciationScorer {
  const provider = context.provider ?? 'self-contained';

  if (provider === 'self-contained') {
    return new SelfContainedScorer();
  }

  throw new Error(
    `Unknown pronunciation scorer provider: "${provider}". ` +
      `Supported: self-contained. Future drop-ins: azure, speechace.`
  );
}
