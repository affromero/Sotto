import { createAIProvider } from './providers/ai';
import type { ScriptTurn, GeneratedReference } from './script-generator';
import { hashTurn, matchClaimsToTurns } from './turn-diff';
import { loadPrompt, loadAndRender } from './prompt-loader';
import { logger } from './logger';

/**
 * Extract the first complete JSON object from a string that may contain
 * surrounding text (markdown fences, AI preamble, trailing notes).
 * Uses balanced-brace counting instead of a greedy regex so trailing `}`
 * characters in non-JSON text don't extend the match past the object boundary.
 */
function extractFirstJsonObject(text: string): string {
  const trimmed = text.trim();
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {}

  const start = text.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in response');

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  throw new Error('Unbalanced JSON object in response');
}

/** Token budget for verification output — must accommodate 30+ claims with detailed notes. */
const VERIFICATION_MAX_TOKENS = 65536;

const PARSE_FAILURE_FEEDBACK = 'PARSE_ERROR: Script verification failed: could not parse AI response. Will retry.';

export const VERIFICATION_JSON_SCHEMA = {
  name: 'verification_result',
  schema: {
    type: 'object',
    properties: {
      claims: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            claimText: { type: 'string' },
            turnIndex: { type: 'integer' },
            speaker: { type: 'string' },
            isCommonKnowledge: { type: 'boolean' },
            existingCitations: { type: 'array', items: { type: 'integer' } },
            needsMoreCitations: { type: 'boolean' },
            hasUnreliableSource: { type: 'boolean' },
            hasMisattribution: { type: 'boolean' },
            verificationNote: { type: 'string' },
          },
          required: [
            'claimText', 'turnIndex', 'speaker', 'isCommonKnowledge',
            'existingCitations', 'needsMoreCitations', 'hasUnreliableSource',
            'hasMisattribution', 'verificationNote',
          ],
          additionalProperties: false,
        },
      },
      overallScore: { type: 'number' },
      feedback: { type: 'string' },
    },
    required: ['claims', 'overallScore', 'feedback'],
    additionalProperties: false,
  },
} as const;

async function retryParseWithStricterPrompt(
  systemPrompt: string,
  userMessage: string,
  opts: { maxTokens: number; apiKeyOverride?: string; model?: string; provider?: string },
): Promise<{ parsed: Record<string, unknown>; inputTokens: number; outputTokens: number; model: string } | null> {
  try {
    const ai = createAIProvider(opts.provider);
    const response = await ai.generateResponse(
      systemPrompt + '\n\nCRITICAL: You MUST respond with ONLY a valid JSON object. No prose, no markdown fences, no explanation. Start with { and end with }.',
      [{ role: 'user', content: userMessage + '\n\nRespond with ONLY valid JSON.' }],
      { maxTokens: opts.maxTokens, apiKeyOverride: opts.apiKeyOverride, model: opts.model, useWebSearch: true, skipModeration: true },
    );
    const parsed = JSON.parse(extractFirstJsonObject(response.content));
    return { parsed, inputTokens: response.inputTokens, outputTokens: response.outputTokens, model: response.model };
  } catch {
    return null;
  }
}

export interface ClaimAnalysis {
  claimText: string;
  turnIndex: number;
  speaker: string;
  isCommonKnowledge: boolean;
  existingCitations: number[];
  needsMoreCitations: boolean;
  hasUnreliableSource: boolean;
  /** Which specific citation numbers are unreliable (e.g. Reddit, blogs). */
  unreliableCitations?: number[];
  hasMisattribution: boolean;
  verificationNote: string;
  turnHash?: string;
}

export interface VerificationVerdict {
  passed: boolean;
  score: number;
  totalClaims: number;
  commonKnowledgeClaims: number;
  adequatelySourcedClaims: number;
  unsupportedClaims: ClaimAnalysis[];
  underSourcedClaims: ClaimAnalysis[];
  unreliableSourceClaims: ClaimAnalysis[];
  misattributedClaims: ClaimAnalysis[];
  referenceQuality: ReferenceQualityAssessment;
  durationFeedback: string | null;
  feedback: string;
  /** Set to 'parse_error' when the AI returned unparseable output (not a verification failure). */
  failureType?: 'parse_error';
  inputTokens: number;
  outputTokens: number;
  model: string;
  allClaims: ClaimAnalysis[];
}

const UNRELIABLE_DOMAINS = [
  'medium.com',
  'substack.com',
  'reddit.com',
  'quora.com',
  'twitter.com',
  'x.com',
  'facebook.com',
  'blogspot.com',
  'wordpress.com',
  'tumblr.com',
  'buzzfeed.com',
  'ehow.com',
  'wikihow.com',
  'about.com',
];

const DEPTH_THRESHOLDS: Record<string, number> = {
  deep_dive: 0.9,
  standard: 0.8,
  quick_overview: 0.7,
  eli5: 0.6,
};

// Base counts (floor) per depth — used when durationMinutes is undefined
const BASE_REFERENCE_COUNTS: Record<string, number> = {
  deep_dive: 10,
  standard: 5,
  quick_overview: 3,
  eli5: 3,
};

// References per minute by depth
const REFS_PER_MINUTE: Record<string, number> = {
  deep_dive: 1.5,
  standard: 1.0,
  quick_overview: 0.7,
  eli5: 0.5,
};

const MAX_REFERENCE_COUNT = 30;

export function getMinReferenceCount(depth: string, durationMinutes?: number): number {
  const base = BASE_REFERENCE_COUNTS[depth] ?? 5;
  if (!durationMinutes || durationMinutes <= 0) return base;
  const scaled = Math.round((REFS_PER_MINUTE[depth] ?? 1.0) * durationMinutes);
  return Math.min(MAX_REFERENCE_COUNT, Math.max(base, scaled));
}

/** @deprecated Use getMinReferenceCount() instead */
export const MIN_REFERENCE_COUNTS = BASE_REFERENCE_COUNTS;

export const SERIOUS_REFERENCE_TYPES: Set<string> = new Set(['PAPER', 'BOOK', 'REPORT']);

const BASE_SERIOUS_RATIO: Record<string, number> = {
  deep_dive: 0.6,
  standard: 0.4,
  quick_overview: 0.2,
  eli5: 0,
};

const LOW_SERIOUS_TONES = new Set(['comedic', 'satirical', 'storytelling']);

export function getMinSeriousRatio(depth: string, tone?: string): number {
  const base = BASE_SERIOUS_RATIO[depth] ?? 0.4;
  if (tone && LOW_SERIOUS_TONES.has(tone)) return Math.max(0, base * 0.5);
  return base;
}

/** @deprecated Use getMinSeriousRatio() instead */
export const MIN_SERIOUS_RATIO = BASE_SERIOUS_RATIO;

export const REFERENCE_TYPE_WEIGHTS: Record<string, number> = {
  PAPER: 1.0,
  BOOK: 0.9,
  REPORT: 0.85,
  ARTICLE: 0.6,
  VIDEO: 0.5,
  WEB: 0.4,
};

export interface ReferenceQualityAssessment {
  totalCount: number;
  requiredCount: number;
  countPassed: boolean;
  seriousCount: number;
  seriousRatio: number;
  requiredSeriousRatio: number;
  ratioPassed: boolean;
  qualityScore: number;
  feedback: string | null;
}

export function assessReferenceQuality(
  references: GeneratedReference[],
  depth: string,
  durationMinutes?: number,
  tone?: string,
): ReferenceQualityAssessment {
  const totalCount = references.length;
  const requiredCount = getMinReferenceCount(depth, durationMinutes);
  const countPassed = totalCount >= requiredCount;

  const seriousCount = references.filter((r) => SERIOUS_REFERENCE_TYPES.has(r.type)).length;
  const seriousRatio = totalCount > 0 ? seriousCount / totalCount : 0;
  const requiredSeriousRatio = getMinSeriousRatio(depth, tone);
  const ratioPassed = seriousRatio >= requiredSeriousRatio;

  const qualityScore =
    totalCount > 0
      ? references.reduce((sum, r) => sum + (REFERENCE_TYPE_WEIGHTS[r.type] ?? 0.4), 0) / totalCount
      : 0;

  const problems: string[] = [];
  if (!countPassed) {
    problems.push(
      `Only ${totalCount} reference(s) provided, but ${depth} depth requires at least ${requiredCount}. Add more references — prefer peer-reviewed papers (PAPER), books (BOOK), and official reports (REPORT).`
    );
  }
  if (!ratioPassed) {
    const pct = Math.round(seriousRatio * 100);
    const reqPct = Math.round(requiredSeriousRatio * 100);
    problems.push(
      `Only ${pct}% of references are serious sources (PAPER/BOOK/REPORT), but ${depth} depth requires at least ${reqPct}%. Replace WEB/ARTICLE references with peer-reviewed papers, books, or official reports where possible.`
    );
  }

  return {
    totalCount,
    requiredCount,
    countPassed,
    seriousCount,
    seriousRatio,
    requiredSeriousRatio,
    ratioPassed,
    qualityScore,
    feedback: problems.length > 0 ? problems.join(' ') : null,
  };
}

import { countWords, wordCountBounds } from './duration';

function buildVerdict(
  claims: ClaimAnalysis[],
  references: GeneratedReference[],
  depth: string,
  maxDurationMinutes: number | undefined,
  turns: ScriptTurn[],
  aiFeedback: string,
  tokenUsage: { inputTokens: number; outputTokens: number; model: string },
  verificationMode?: string,
  tone?: string,
  durationTarget?: number,
): VerificationVerdict {
  const commonKnowledgeClaims = claims.filter((c) => c.isCommonKnowledge);
  const sourcingRequired = claims.filter((c) => !c.isCommonKnowledge);
  const unsupportedClaims = sourcingRequired.filter((c) => c.existingCitations.length === 0);
  const underSourcedClaims = sourcingRequired.filter(
    (c) => c.needsMoreCitations && c.existingCitations.length > 0
  );
  const unreliableSourceClaims = sourcingRequired.filter((c) => c.hasUnreliableSource);
  const misattributedClaims = sourcingRequired.filter((c) => c.hasMisattribution);
  const adequatelySourcedClaims = sourcingRequired.filter(
    (c) => c.existingCitations.length > 0 && !c.needsMoreCitations && !c.hasUnreliableSource && !c.hasMisattribution
  );

  const totalWords = turns.reduce((sum, t) => sum + countWords(t.text), 0);
  let tooLong = false;
  let tooShort = false;
  if (maxDurationMinutes) {
    const bounds = wordCountBounds(maxDurationMinutes);
    tooLong = totalWords > bounds.max;
    tooShort = totalWords < bounds.min;
  }

  let durationFeedback: string | null = null;
  if (maxDurationMinutes && (tooLong || tooShort)) {
    const bounds = wordCountBounds(maxDurationMinutes);
    if (tooLong) {
      durationFeedback = `The script is ${totalWords} words, which exceeds the maximum of ${bounds.max} words for a ${maxDurationMinutes}-minute podcast. Reduce to ${bounds.min}–${bounds.max} words (${bounds.target} ideal).`;
    } else {
      durationFeedback = `The script is ${totalWords} words, which is below the minimum of ${bounds.min} words for a ${maxDurationMinutes}-minute podcast. Expand to ${bounds.min}–${bounds.max} words (${bounds.target} ideal).`;
    }
  }

  const score =
    sourcingRequired.length === 0
      ? 1
      : (sourcingRequired.length - unsupportedClaims.length - unreliableSourceClaims.length - misattributedClaims.length) /
        sourcingRequired.length;

  const isRelaxed = verificationMode === 'relaxed';
  // Relaxed mode uses ELI5-level thresholds and doesn't hard-fail on unreliable sources
  const effectiveDepth = isRelaxed ? 'eli5' : depth;
  const threshold = DEPTH_THRESHOLDS[effectiveDepth] || 0.8;

  const refQuality = assessReferenceQuality(references, isRelaxed ? 'eli5' : depth, durationTarget, tone);

  // Misattribution tolerance: allow up to 2 for standard/quick/eli5, strict zero for deep_dive
  const misattributionLimit = depth === 'deep_dive' ? 0 : 2;

  const passed = isRelaxed
    ? score >= threshold && refQuality.countPassed
    : score >= threshold &&
      unreliableSourceClaims.length === 0 &&
      misattributedClaims.length <= misattributionLimit &&
      refQuality.countPassed &&
      refQuality.ratioPassed;

  // Strip any PASS:/FAIL: prefix the AI may have written (instruction removed, but AI is non-deterministic)
  const cleanAiFeedback = aiFeedback.replace(/^(PASS|FAIL):\s*/i, '');
  let feedback = cleanAiFeedback;
  if (misattributedClaims.length > 0) {
    const misattrFeedback = `MISATTRIBUTION: ${misattributedClaims.length} claim(s) inaccurately describe their cited references. ` +
      misattributedClaims.map((c) => `Turn ${c.turnIndex}: "${c.claimText}" — ${c.verificationNote}`).join('; ');
    feedback = feedback ? `${feedback}\n\n${misattrFeedback}` : misattrFeedback;
  }
  if (refQuality.feedback) {
    feedback = feedback ? `${feedback}\n\nREFERENCES: ${refQuality.feedback}` : `REFERENCES: ${refQuality.feedback}`;
  }

  // Programmatically signal failure so the revision loop always knows to act,
  // even when the AI judged the score passing but a reference quality gate failed.
  if (!passed) {
    feedback = feedback ? `FAIL: ${feedback}` : 'FAIL: Script did not meet verification requirements.';
  }

  return {
    passed,
    score,
    totalClaims: claims.length,
    commonKnowledgeClaims: commonKnowledgeClaims.length,
    adequatelySourcedClaims: adequatelySourcedClaims.length,
    unsupportedClaims,
    underSourcedClaims,
    unreliableSourceClaims,
    misattributedClaims,
    referenceQuality: refQuality,
    durationFeedback,
    feedback,
    allClaims: claims,
    inputTokens: tokenUsage.inputTokens,
    outputTokens: tokenUsage.outputTokens,
    model: tokenUsage.model,
  };
}

function formatReferencesText(references: GeneratedReference[]): string {
  return references
    .map((r) => {
      const domain = r.url ? extractDomain(r.url) : 'no-url';
      const unreliable = UNRELIABLE_DOMAINS.some((d) => domain.includes(d));
      return `[${r.number}] "${r.title}" by ${r.authors.join(', ') || 'unknown'} (${r.year || 'n/a'}) — ${r.type} — URL: ${r.url || 'none'} — DOI: ${r.doi || 'none'}${unreliable ? ' [UNRELIABLE SOURCE]' : ''}`;
    })
    .join('\n');
}

function buildSystemPrompt(
  audienceLevel: string,
  attemptNumber: number,
  previousFeedback: string | undefined,
  incrementalContext?: { carriedClaims: ClaimAnalysis[]; changedIndices: Set<number>; turnsLength: number }
): string {
  let prompt = loadAndRender('verification/script-verifier-base.md', {
    AUDIENCE_LEVEL: audienceLevel,
    ATTEMPT_NUMBER: String(attemptNumber),
  });

  if (previousFeedback) {
    prompt += loadAndRender('verification/script-verifier-previous-feedback.md', {
      PREVIOUS_FEEDBACK: previousFeedback,
    });
  }

  if (incrementalContext) {
    const unchangedIndices = [...Array(incrementalContext.turnsLength).keys()]
      .filter((i) => !incrementalContext.changedIndices.has(i));
    const changedList = [...incrementalContext.changedIndices].sort((a, b) => a - b);

    prompt += loadAndRender('verification/script-verifier-incremental.md', {
      UNCHANGED_INDICES: unchangedIndices.length > 0 ? unchangedIndices.join(', ') : 'none',
      CARRIED_CLAIMS: incrementalContext.carriedClaims.map((c) => `- Turn ${c.turnIndex} (${c.speaker}): "${c.claimText}" — ${c.verificationNote}`).join('\n'),
      CHANGED_LIST: changedList.join(', '),
    });
  }

  prompt += loadPrompt('verification/script-verifier-output-format.md');

  return prompt;
}

function parseClaims(
  parsed: { claims: Array<Record<string, unknown>>; feedback: string },
  turns: ScriptTurn[]
): { claims: ClaimAnalysis[]; aiFeedback: string } {
  const claims: ClaimAnalysis[] = (parsed.claims || []).map((c) => ({
    claimText: c.claimText as string,
    turnIndex: c.turnIndex as number,
    speaker: c.speaker as string,
    isCommonKnowledge: c.isCommonKnowledge as boolean,
    existingCitations: (c.existingCitations as number[]) || [],
    needsMoreCitations: c.needsMoreCitations as boolean,
    hasUnreliableSource: c.hasUnreliableSource as boolean,
    hasMisattribution: (c.hasMisattribution as boolean) ?? false,
    verificationNote: c.verificationNote as string,
    turnHash: c.turnIndex != null && (c.turnIndex as number) < turns.length
      ? hashTurn(turns[c.turnIndex as number].speaker, turns[c.turnIndex as number].text)
      : undefined,
  }));
  return { claims, aiFeedback: parsed.feedback || '' };
}

/**
 * Verify a podcast script by extracting factual claims and evaluating sourcing.
 * Acts as a "teacher" checking homework — every non-obvious claim needs adequate sourcing.
 *
 * When `previousClaims` is provided, unchanged turns are carried forward without
 * re-analysis, and only changed/new turns are sent to the AI.
 */
export async function verifyScript(params: {
  topic: string;
  turns: ScriptTurn[];
  references: GeneratedReference[];
  depth: string;
  audienceLevel: string;
  attemptNumber: number;
  maxDurationMinutes?: number;
  tone?: string;
  durationTarget?: number;
  previousFeedback?: string;
  apiKeyOverride?: string;
  model?: string;
  provider?: string;
  previousClaims?: ClaimAnalysis[];
  verificationMode?: string;
}): Promise<VerificationVerdict> {
  const {
    topic,
    turns,
    references,
    depth,
    audienceLevel,
    attemptNumber,
    maxDurationMinutes,
    previousFeedback,
    previousClaims,
  } = params;

  // Incremental path: carry forward verified claims for unchanged turns
  if (previousClaims && previousClaims.length > 0) {
    const { carried: rawCarried, changedIndices } = matchClaimsToTurns(previousClaims, turns);

    // Force re-analysis of turns that had problems in previous rounds.
    // The generator may have fixed a reference while keeping the turn text unchanged —
    // the hash matches but the verdict could now differ with the replaced source.
    const problemTurnIndices = new Set(
      rawCarried
        .filter((c) => c.hasUnreliableSource || c.hasMisattribution)
        .map((c) => c.turnIndex)
    );
    for (const idx of problemTurnIndices) {
      changedIndices.add(idx);
    }
    const carried = rawCarried.filter((c) => !problemTurnIndices.has(c.turnIndex));

    // All turns unchanged → skip AI call entirely
    if (changedIndices.size === 0) {
      return buildVerdict(carried, references, depth, maxDurationMinutes, turns, '', {
        inputTokens: 0,
        outputTokens: 0,
        model: params.model || 'skipped',
      }, params.verificationMode, params.tone, params.durationTarget);
    }

    const turnsText = turns.map((t, i) => `[Turn ${i}] ${t.speaker}: ${t.text}`).join('\n\n');
    const referencesText = formatReferencesText(references);

    const systemPrompt = buildSystemPrompt(audienceLevel, attemptNumber, previousFeedback, {
      carriedClaims: carried,
      changedIndices,
      turnsLength: turns.length,
    });

    const userMessage = `Topic: ${topic}
Depth: ${depth}
Audience: ${audienceLevel}

=== SCRIPT ===
${turnsText}

=== REFERENCES ===
${referencesText}

Analyze ONLY the changed turns listed in the system instructions. Return JSON only.`;

    const ai = createAIProvider(params.provider);
    const response = await ai.generateResponse(systemPrompt, [{ role: 'user', content: userMessage }], {
      maxTokens: VERIFICATION_MAX_TOKENS,
      apiKeyOverride: params.apiKeyOverride,
      model: params.model,
      useWebSearch: true,
      skipModeration: true,
      jsonSchema: VERIFICATION_JSON_SCHEMA,
    });

    let parsed: { claims: Array<Record<string, unknown>>; overallScore: number; feedback: string };
    let extraInputTokens = 0;
    let extraOutputTokens = 0;

    try {
      parsed = JSON.parse(extractFirstJsonObject(response.content));
    } catch {
      const retry = await retryParseWithStricterPrompt(systemPrompt, userMessage, {
        maxTokens: VERIFICATION_MAX_TOKENS, apiKeyOverride: params.apiKeyOverride, model: params.model, provider: params.provider,
      });
      if (retry) {
        parsed = retry.parsed as typeof parsed;
        extraInputTokens = retry.inputTokens;
        extraOutputTokens = retry.outputTokens;
      } else {
        const likelyTruncated = response.outputTokens >= VERIFICATION_MAX_TOKENS * 0.95;
        logger.error('Script verification parse failure (incremental path)', {
          provider: params.provider ?? 'default',
          model: response.model,
          outputTokens: String(response.outputTokens),
          maxTokens: String(VERIFICATION_MAX_TOKENS),
          likelyTruncated: String(likelyTruncated),
          responsePreview: response.content.slice(0, 500),
        });
        return {
          passed: false,
          score: 0,
          totalClaims: 0,
          commonKnowledgeClaims: 0,
          adequatelySourcedClaims: 0,
          unsupportedClaims: [],
          underSourcedClaims: [],
          unreliableSourceClaims: [],
          misattributedClaims: [],
          referenceQuality: {
            totalCount: 0,
            requiredCount: getMinReferenceCount(params.verificationMode === 'relaxed' ? 'eli5' : depth, params.durationTarget),
            countPassed: false,
            seriousCount: 0,
            seriousRatio: 0,
            requiredSeriousRatio: getMinSeriousRatio(params.verificationMode === 'relaxed' ? 'eli5' : depth, params.tone),
            ratioPassed: false,
            qualityScore: 0,
            feedback: null,
          },
          durationFeedback: null,
          feedback: PARSE_FAILURE_FEEDBACK,
          failureType: 'parse_error',
          allClaims: [],
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          model: response.model,
        };
      }
    }

    const { claims: newClaims, aiFeedback } = parseClaims(parsed, turns);

    // Dedup: if AI re-analyzed a pre-verified turn, new claim takes precedence
    const newClaimTurnIndices = new Set(newClaims.map((c) => c.turnIndex));
    const dedupedCarried = carried.filter((c) => !newClaimTurnIndices.has(c.turnIndex));
    const allClaims = [...dedupedCarried, ...newClaims];

    return buildVerdict(allClaims, references, depth, maxDurationMinutes, turns, aiFeedback, {
      inputTokens: response.inputTokens + extraInputTokens,
      outputTokens: response.outputTokens + extraOutputTokens,
      model: response.model,
    }, params.verificationMode, params.tone, params.durationTarget);
  }

  // Full verification path (attempt 1 or no previous claims)
  const turnsText = turns.map((t, i) => `[Turn ${i}] ${t.speaker}: ${t.text}`).join('\n\n');
  const referencesText = formatReferencesText(references);
  const systemPrompt = buildSystemPrompt(audienceLevel, attemptNumber, previousFeedback);

  const userMessage = `Topic: ${topic}
Depth: ${depth}
Audience: ${audienceLevel}

=== SCRIPT ===
${turnsText}

=== REFERENCES ===
${referencesText}

Analyze every factual claim. Return JSON only.`;

  const ai = createAIProvider(params.provider);
  const response = await ai.generateResponse(systemPrompt, [{ role: 'user', content: userMessage }], {
    maxTokens: VERIFICATION_MAX_TOKENS,
    apiKeyOverride: params.apiKeyOverride,
    model: params.model,
    useWebSearch: true,
    skipModeration: true,
    jsonSchema: VERIFICATION_JSON_SCHEMA,
  });

  let parsed: { claims: Array<Record<string, unknown>>; overallScore: number; feedback: string };
  let extraInputTokens = 0;
  let extraOutputTokens = 0;

  try {
    parsed = JSON.parse(extractFirstJsonObject(response.content));
  } catch {
    const retry = await retryParseWithStricterPrompt(systemPrompt, userMessage, {
      maxTokens: VERIFICATION_MAX_TOKENS, apiKeyOverride: params.apiKeyOverride, model: params.model, provider: params.provider,
    });
    if (retry) {
      parsed = retry.parsed as typeof parsed;
      extraInputTokens = retry.inputTokens;
      extraOutputTokens = retry.outputTokens;
    } else {
      const likelyTruncated = response.outputTokens >= VERIFICATION_MAX_TOKENS * 0.95;
      logger.error('Script verification parse failure (full path)', {
        provider: params.provider ?? 'default',
        model: response.model,
        outputTokens: String(response.outputTokens),
        maxTokens: String(VERIFICATION_MAX_TOKENS),
        likelyTruncated: String(likelyTruncated),
        responsePreview: response.content.slice(0, 500),
      });
      return {
        passed: false,
        score: 0,
        totalClaims: 0,
        commonKnowledgeClaims: 0,
        adequatelySourcedClaims: 0,
        unsupportedClaims: [],
        underSourcedClaims: [],
        unreliableSourceClaims: [],
        misattributedClaims: [],
        referenceQuality: {
          totalCount: 0,
          requiredCount: getMinReferenceCount(depth, params.durationTarget),
          countPassed: false,
          seriousCount: 0,
          seriousRatio: 0,
          requiredSeriousRatio: getMinSeriousRatio(depth, params.tone),
          ratioPassed: false,
          qualityScore: 0,
          feedback: null,
        },
        durationFeedback: null,
        feedback: PARSE_FAILURE_FEEDBACK,
        failureType: 'parse_error',
        allClaims: [],
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        model: response.model,
      };
    }
  }

  const { claims, aiFeedback } = parseClaims(parsed, turns);

  return buildVerdict(claims, references, depth, maxDurationMinutes, turns, aiFeedback, {
    inputTokens: response.inputTokens + extraInputTokens,
    outputTokens: response.outputTokens + extraOutputTokens,
    model: response.model,
  }, params.verificationMode, params.tone, params.durationTarget);
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}
