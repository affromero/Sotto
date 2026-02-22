import { generateResponse, WEB_SEARCH_TOOL } from './claude';
import type { ScriptTurn, GeneratedReference } from './script-generator';

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

/**
 * Verify a podcast script by extracting factual claims and evaluating sourcing.
 * Acts as a "teacher" checking homework — every non-obvious claim needs adequate sourcing.
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
  } = params;

  const turnsText = turns.map((t, i) => `[Turn ${i}] ${t.speaker}: ${t.text}`).join('\n\n');

  const referencesText = references
    .map((r) => {
      const domain = r.url ? extractDomain(r.url) : 'no-url';
      const unreliable = UNRELIABLE_DOMAINS.some((d) => domain.includes(d));
      return `[${r.number}] "${r.title}" by ${r.authors.join(', ') || 'unknown'} (${r.year || 'n/a'}) — ${r.type} — URL: ${r.url || 'none'} — DOI: ${r.doi || 'none'}${unreliable ? ' [UNRELIABLE SOURCE]' : ''}`;
    })
    .join('\n');

  const systemPrompt = `You are a rigorous fact-checking agent for Sotto podcasts. Your job is to review a podcast script like a teacher grading homework.

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

## Passing Criteria:
- Every non-obvious factual claim must have at least 1 citation
- No claims should be backed only by unreliable sources
- Depth-scaled threshold: deep_dive requires 90%, standard 80%, quick_overview 70% of sourced claims to have 3+ verifiable sources
- Overall score must be >= 0.7

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

## This is verification attempt ${attemptNumber} of 3.
${previousFeedback ? `
## Previous Feedback (for context only — the script has been revised since):
The following issues were flagged in the previous round. The script was revised to address them.
Your job is to evaluate the CURRENT script on its own merits:
- If a previously flagged issue has been corrected, do NOT re-flag it.
- If a previously flagged issue still exists in the current text, flag it again with fresh evidence.
- Turn indices may have shifted after revision — match claims by their content, not by turn number.
- Do not assume an issue persists just because it was flagged before — verify against the actual current text.

Previous feedback for reference:
${previousFeedback}` : ''}

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

  let parsed: {
    claims: Array<{
      claimText: string;
      turnIndex: number;
      speaker: string;
      isCommonKnowledge: boolean;
      existingCitations: number[];
      needsMoreCitations: boolean;
      hasUnreliableSource: boolean;
      hasMisattribution: boolean;
      verificationNote: string;
    }>;
    overallScore: number;
    feedback: string;
  };

  try {
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    parsed = JSON.parse(jsonMatch[0]);
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
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      model: response.model,
    };
  }

  const claims: ClaimAnalysis[] = (parsed.claims || []).map((c) => ({
    claimText: c.claimText,
    turnIndex: c.turnIndex,
    speaker: c.speaker,
    isCommonKnowledge: c.isCommonKnowledge,
    existingCitations: c.existingCitations || [],
    needsMoreCitations: c.needsMoreCitations,
    hasUnreliableSource: c.hasUnreliableSource,
    hasMisattribution: c.hasMisattribution ?? false,
    verificationNote: c.verificationNote,
  }));

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

  // Duration check — bidirectional (too long OR too short), only when target is set
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

  // Compute score from actual data rather than trusting AI's self-reported score
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
    !tooLong &&
    !tooShort &&
    refQuality.countPassed &&
    refQuality.ratioPassed;

  let feedback = parsed.feedback || '';
  if (misattributedClaims.length > 0) {
    const misattrFeedback = `MISATTRIBUTION: ${misattributedClaims.length} claim(s) inaccurately describe their cited references. ` +
      misattributedClaims.map((c) => `Turn ${c.turnIndex}: "${c.claimText}" — ${c.verificationNote}`).join('; ');
    feedback = feedback ? `${feedback}\n\n${misattrFeedback}` : misattrFeedback;
  }
  if (durationFeedback) {
    feedback = feedback ? `${feedback}\n\nDURATION: ${durationFeedback}` : durationFeedback;
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
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    model: response.model,
  };
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}
