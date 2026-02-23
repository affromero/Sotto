import { generateResponse, WEB_SEARCH_TOOL } from './claude';
import type { ScriptTurn, GeneratedReference } from './script-generator';
import { hashTurn, matchClaimsToTurns } from './turn-diff';

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

export interface ClaimAnalysis {
  claimText: string;
  turnIndex: number;
  speaker: string;
  isCommonKnowledge: boolean;
  existingCitations: number[];
  needsMoreCitations: boolean;
  hasUnreliableSource: boolean;
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

export const MIN_REFERENCE_COUNTS: Record<string, number> = {
  deep_dive: 10,
  standard: 5,
  quick_overview: 3,
  eli5: 3,
};

export const SERIOUS_REFERENCE_TYPES: Set<string> = new Set(['PAPER', 'BOOK', 'REPORT']);

export const MIN_SERIOUS_RATIO: Record<string, number> = {
  deep_dive: 0.6,
  standard: 0.4,
  quick_overview: 0.2,
  eli5: 0,
};

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
  depth: string
): ReferenceQualityAssessment {
  const totalCount = references.length;
  const requiredCount = MIN_REFERENCE_COUNTS[depth] ?? 5;
  const countPassed = totalCount >= requiredCount;

  const seriousCount = references.filter((r) => SERIOUS_REFERENCE_TYPES.has(r.type)).length;
  const seriousRatio = totalCount > 0 ? seriousCount / totalCount : 0;
  const requiredSeriousRatio = MIN_SERIOUS_RATIO[depth] ?? 0.4;
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
  tokenUsage: { inputTokens: number; outputTokens: number; model: string }
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
  const threshold = DEPTH_THRESHOLDS[depth] || 0.8;

  const refQuality = assessReferenceQuality(references, depth);

  const passed =
    score >= threshold &&
    unreliableSourceClaims.length === 0 &&
    misattributedClaims.length === 0 &&
    refQuality.countPassed &&
    refQuality.ratioPassed;

  let feedback = aiFeedback;
  if (misattributedClaims.length > 0) {
    const misattrFeedback = `MISATTRIBUTION: ${misattributedClaims.length} claim(s) inaccurately describe their cited references. ` +
      misattributedClaims.map((c) => `Turn ${c.turnIndex}: "${c.claimText}" — ${c.verificationNote}`).join('; ');
    feedback = feedback ? `${feedback}\n\n${misattrFeedback}` : misattrFeedback;
  }
  if (refQuality.feedback) {
    feedback = feedback ? `${feedback}\n\nREFERENCES: ${refQuality.feedback}` : `REFERENCES: ${refQuality.feedback}`;
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
  incrementalContext?: { carriedClaims: ClaimAnalysis[]; changedIndices: Set<number> }
): string {
  const basePrompt = `You are a rigorous fact-checking agent for Sotto podcasts. Your job is to review a podcast script like a teacher grading homework.

Note: The script may contain inline audio tags like [laughs], [sighs], [whispers], [gasps], [chuckles]. These are TTS formatting markers — ignore them when evaluating claims.

## Your Task:
1. Extract every factual claim from the dialogue. Ignore: greetings, transitions, opinions, rhetorical questions, conversational filler, and audio tags.
2. Classify each claim as COMMON_KNOWLEDGE or REQUIRES_SOURCING.
   - COMMON_KNOWLEDGE: universally known facts (e.g., "water boils at 100C", "the earth orbits the sun")
   - REQUIRES_SOURCING: specific statistics, study results, historical claims, technical details, quotes, dates, biographical claims (a person's title, affiliation, institution, credentials, professional role). Any statement of the form "X is a professor/CEO/researcher/expert at Y" is a factual claim that REQUIRES_SOURCING — not common knowledge.
3. For each REQUIRES_SOURCING claim:
   - Check if it has citation markers [N] in the text
   - Check if the cited references are from reliable sources (NOT personal blogs, social media, content farms)
   - Assess whether 3+ independent, reputable sources could verify the claim
4. Flag any claims backed only by unreliable sources (Medium, Substack, Reddit, Quora, Twitter/X, Facebook, Blogspot, WordPress free hosted, Tumblr, BuzzFeed, eHow, wikiHow, About.com)

## Source Reliability Tiers (prefer higher tiers):
**Tier 1 — Strongest:**
- Peer-reviewed journals (Nature, Science, PNAS, Lancet, etc.)
- Published books from academic/major publishers
- Government reports (.gov domains)
- Official organization reports (WHO, UNESCO, etc.)

**Tier 2 — Strong:**
- Academic institutions (.edu, .ac.* domains)
- Established news outlets (Reuters, AP, BBC, NYT, etc.)
- ArXiv preprints (acceptable for recent research)

**Tier 3 — Acceptable for established facts:**
- Wikipedia — acceptable for well-established historical facts, dates, and definitions. Do NOT flag Wikipedia as unreliable. However, for contested claims, recent statistics, or cutting-edge research, prefer Tier 1–2 sources.

**NOT acceptable for empirical, statistical, or causal claims (set hasUnreliableSource: true):**
- Design agency blogs and marketing sites (e.g., designmodo.com, gouldingmedia.com, canva.com/learn, hubspot.com/blog) — acceptable for design opinions but NOT for psychological or behavioral statistics
- Educational aggregator blogs (e.g., cognitiontoday.com, psychologytoday.com when citing secondary sources) — not acceptable as primary sources for research findings
- Career advice / lifestyle sites (e.g., interviewguys.com, thebalancecareers.com, indeed.com/career-advice) — not acceptable for behavioral or psychological claims
- SEO content farms and "roundup" articles that cite other blogs rather than primary sources
- Any source that itself cites only secondary sources (blog → blog → no primary)
Note: These sources may be acceptable for definitions, opinions, or practical advice — but any quantitative finding, study result, or causal claim from them requires a Tier 1–2 primary source.

## Passing Criteria:
- Every non-obvious factual claim must have at least 1 citation
- **HARD FAIL (regardless of score): If ANY claim has hasUnreliableSource: true, the script fails.** Include "FAIL:" at the start of your feedback and explicitly list which citations are unacceptable and what Tier 1–2 replacements would work.
- Depth-scaled threshold: deep_dive requires 90%, standard 80%, quick_overview 70% of sourced claims to have 3+ verifiable sources
- Overall score must be >= 0.7
- **If all hard conditions pass AND score >= threshold: begin feedback with "PASS:" followed by any improvement suggestions.**

## Audience Level Context:
Level "${audienceLevel}" — adjust expectations accordingly. Expert-level content needs stricter sourcing.

## Web Search:
You have access to web search. Use it to:
- Verify whether cited sources actually exist (search for the title, authors, and publication)
- Cross-check specific factual claims against current, authoritative sources
- Find real sources to suggest as replacements for unverifiable citations
Do NOT rely solely on your training data — actively search to confirm or refute each non-obvious claim.

## Credential Claims — Extra Scrutiny:
When the script attributes credentials to a named person (e.g., "Dr. Smith, a physicist at MIT"),
this is a HIGH-RISK factual claim. You must:
1. Flag it as REQUIRES_SOURCING regardless of context
2. Use web search to verify: does this person exist? Do they hold this title at this institution?
3. If the source material includes [VERIFIED] credential markers, cross-check that the script
   faithfully reproduces them without embellishment
4. If a credential claim appears that is NOT in the source material and cannot be verified via
   web search, flag it as UNSUPPORTED and request removal or correction
5. Never allow a credential claim to pass as COMMON_KNOWLEDGE

## Reference Attribution Accuracy

For each citation [N], check that the surrounding text accurately describes the referenced source.
Cross-check against the reference metadata provided above.

Set hasMisattribution to true if:
- The script names an institution/lab not found in the reference's authors or publisher
- The script names a publisher/venue that doesn't match the reference's publisher
- The script states a year that doesn't match the reference's year
- The script names specific authors not listed in the reference's authors array

## This is verification attempt ${attemptNumber} of 3.`;

  let prompt = basePrompt;

  if (previousFeedback) {
    prompt += `
## Previous Feedback (for context only — the script has been revised since):
The following issues were flagged in the previous round. The script was revised to address them.
Your job is to evaluate the CURRENT script on its own merits:
- If a previously flagged issue has been corrected, do NOT re-flag it.
- If a previously flagged issue still exists in the current text, flag it again with fresh evidence.
- Turn indices may have shifted after revision — match claims by their content, not by turn number.
- Do not assume an issue persists just because it was flagged before — verify against the actual current text.

Previous feedback for reference:
${previousFeedback}`;
  }

  if (incrementalContext) {
    const unchangedIndices = [...Array(incrementalContext.changedIndices.size + incrementalContext.carriedClaims.length).keys()]
      .filter((i) => !incrementalContext.changedIndices.has(i));
    const changedList = [...incrementalContext.changedIndices].sort((a, b) => a - b);

    prompt += `

## INCREMENTAL VERIFICATION — IMPORTANT
This is a re-verification after script revision. Some turns are UNCHANGED from the previous version and have already been verified.

**Pre-verified turns (DO NOT re-analyze these):** ${unchangedIndices.length > 0 ? unchangedIndices.join(', ') : 'none'}
Previously verified claims for context:
${incrementalContext.carriedClaims.map((c) => `- Turn ${c.turnIndex} (${c.speaker}): "${c.claimText}" — ${c.verificationNote}`).join('\n')}

**Turns requiring analysis (ONLY analyze these):** ${changedList.join(', ')}

You MUST only return claims for the turns listed above as "requiring analysis". Do NOT return claims for pre-verified turns.`;
  }

  prompt += `

## Output Format:
Return a JSON object:
{
  "claims": [
    {
      "claimText": "the specific claim",
      "turnIndex": 0,
      "speaker": "HOST" | "EXPERT",
      "isCommonKnowledge": false,
      "existingCitations": [1, 3],
      "needsMoreCitations": true,
      "hasUnreliableSource": false,
      "hasMisattribution": false,
      "verificationNote": "brief explanation"
    }
  ],
  "overallScore": 0.85,
  "feedback": "Concise revision instructions if score < threshold. Be specific about which claims need better sourcing and what kind of sources would be acceptable."
}

Return ONLY the JSON object.`;

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
  previousFeedback?: string;
  apiKeyOverride?: string;
  model?: string;
  previousClaims?: ClaimAnalysis[];
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
      });
    }

    const turnsText = turns.map((t, i) => `[Turn ${i}] ${t.speaker}: ${t.text}`).join('\n\n');
    const referencesText = formatReferencesText(references);

    const systemPrompt = buildSystemPrompt(audienceLevel, attemptNumber, previousFeedback, {
      carriedClaims: carried,
      changedIndices,
    });

    const userMessage = `Topic: ${topic}
Depth: ${depth}
Audience: ${audienceLevel}

=== SCRIPT ===
${turnsText}

=== REFERENCES ===
${referencesText}

Analyze ONLY the changed turns listed in the system instructions. Return JSON only.`;

    const response = await generateResponse(systemPrompt, [{ role: 'user', content: userMessage }], {
      maxTokens: 8192,
      apiKeyOverride: params.apiKeyOverride,
      model: params.model,
      tools: [WEB_SEARCH_TOOL],
      skipModeration: true,
    });

    let parsed: { claims: Array<Record<string, unknown>>; overallScore: number; feedback: string };
    try {
      parsed = JSON.parse(extractFirstJsonObject(response.content));
    } catch {
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
          requiredCount: MIN_REFERENCE_COUNTS[depth] ?? 5,
          countPassed: false,
          seriousCount: 0,
          seriousRatio: 0,
          requiredSeriousRatio: MIN_SERIOUS_RATIO[depth] ?? 0.4,
          ratioPassed: false,
          qualityScore: 0,
          feedback: null,
        },
        durationFeedback: null,
        feedback: 'Script verification failed: could not parse AI response. Will retry.',
        allClaims: [],
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        model: response.model,
      };
    }

    const { claims: newClaims, aiFeedback } = parseClaims(parsed, turns);

    // Dedup: if AI re-analyzed a pre-verified turn, new claim takes precedence
    const newClaimTurnIndices = new Set(newClaims.map((c) => c.turnIndex));
    const dedupedCarried = carried.filter((c) => !newClaimTurnIndices.has(c.turnIndex));
    const allClaims = [...dedupedCarried, ...newClaims];

    return buildVerdict(allClaims, references, depth, maxDurationMinutes, turns, aiFeedback, {
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      model: response.model,
    });
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

  const response = await generateResponse(systemPrompt, [{ role: 'user', content: userMessage }], {
    maxTokens: 8192,
    apiKeyOverride: params.apiKeyOverride,
    model: params.model,
    tools: [WEB_SEARCH_TOOL],
    skipModeration: true,
  });

  let parsed: { claims: Array<Record<string, unknown>>; overallScore: number; feedback: string };

  try {
    parsed = JSON.parse(extractFirstJsonObject(response.content));
  } catch {
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
        requiredCount: MIN_REFERENCE_COUNTS[depth] ?? 5,
        countPassed: false,
        seriousCount: 0,
        seriousRatio: 0,
        requiredSeriousRatio: MIN_SERIOUS_RATIO[depth] ?? 0.4,
        ratioPassed: false,
        qualityScore: 0,
        feedback: null,
      },
      durationFeedback: null,
      feedback: 'Script verification failed: could not parse AI response. Will retry.',
      allClaims: [],
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      model: response.model,
    };
  }

  const { claims, aiFeedback } = parseClaims(parsed, turns);

  return buildVerdict(claims, references, depth, maxDurationMinutes, turns, aiFeedback, {
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    model: response.model,
  });
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}
