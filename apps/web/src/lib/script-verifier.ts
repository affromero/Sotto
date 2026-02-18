import { generateResponse, WEB_SEARCH_TOOL } from './claude';
import type { ScriptTurn, GeneratedReference } from './script-generator';

export interface ClaimAnalysis {
  claimText: string;
  turnIndex: number;
  speaker: 'HOST' | 'EXPERT';
  isCommonKnowledge: boolean;
  existingCitations: number[];
  needsMoreCitations: boolean;
  hasUnreliableSource: boolean;
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
  durationFeedback: string | null;
  feedback: string;
  inputTokens: number;
  outputTokens: number;
}

const UNRELIABLE_DOMAINS = [
  'wikipedia.org',
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
};

import { WORDS_PER_MINUTE, wordCountBounds } from './duration';

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
   - REQUIRES_SOURCING: specific statistics, study results, historical claims, technical details, quotes, dates
3. For each REQUIRES_SOURCING claim:
   - Check if it has citation markers [N] in the text
   - Check if the cited references are from reliable sources (NOT Wikipedia, personal blogs, social media, content farms)
   - Assess whether 3+ independent, reputable sources could verify the claim
4. Flag any claims backed only by unreliable sources (Wikipedia, Medium, Substack, Reddit, Quora, Twitter/X, Facebook, Blogspot, WordPress free hosted, Tumblr, BuzzFeed, eHow, wikiHow, About.com)

## Reliable Sources Include:
- Peer-reviewed journals (Nature, Science, PNAS, Lancet, etc.)
- Published books from academic/major publishers
- Government reports (.gov domains)
- Academic institutions (.edu, .ac.* domains)
- Established news outlets (Reuters, AP, BBC, NYT, etc.)
- ArXiv preprints (acceptable for recent research)
- Official organization reports (WHO, UNESCO, etc.)

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

## This is attempt ${attemptNumber} of 3.
${previousFeedback ? `\n## Previous Feedback (that the script was revised to address):\n${previousFeedback}` : ''}

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
      speaker: 'HOST' | 'EXPERT';
      isCommonKnowledge: boolean;
      existingCitations: number[];
      needsMoreCitations: boolean;
      hasUnreliableSource: boolean;
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
      durationFeedback: null,
      feedback: 'Script verification failed: could not parse AI response. Will retry.',
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
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
    verificationNote: c.verificationNote,
  }));

  const commonKnowledgeClaims = claims.filter((c) => c.isCommonKnowledge);
  const sourcingRequired = claims.filter((c) => !c.isCommonKnowledge);
  const unsupportedClaims = sourcingRequired.filter((c) => c.existingCitations.length === 0);
  const underSourcedClaims = sourcingRequired.filter(
    (c) => c.needsMoreCitations && c.existingCitations.length > 0
  );
  const unreliableSourceClaims = sourcingRequired.filter((c) => c.hasUnreliableSource);
  const adequatelySourcedClaims = sourcingRequired.filter(
    (c) => c.existingCitations.length > 0 && !c.needsMoreCitations && !c.hasUnreliableSource
  );

  // Duration check — bidirectional (too long OR too short), only when target is set
  const totalWords = turns.reduce((sum, t) => sum + t.text.split(/\s+/).length, 0);
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
      : (sourcingRequired.length - unsupportedClaims.length - unreliableSourceClaims.length) /
        sourcingRequired.length;
  const threshold = DEPTH_THRESHOLDS[depth] || 0.8;

  const passed =
    score >= threshold && unreliableSourceClaims.length === 0 && !tooLong && !tooShort;

  let feedback = parsed.feedback || '';
  if (durationFeedback) {
    feedback = feedback ? `${feedback}\n\nDURATION: ${durationFeedback}` : durationFeedback;
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
    durationFeedback,
    feedback,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
  };
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}
