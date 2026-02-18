import { generateResponse, WEB_SEARCH_TOOL } from './claude';
import { CONTENT_SAFETY_INSTRUCTIONS, MATURE_AUDIENCE_GUIDANCE } from './safety-prompts';
import { minutesToWords, wordCountBounds } from './duration';

export type ScriptTurn = {
  speaker: 'HOST' | 'EXPERT';
  text: string;
  direction?: string; // delivery direction: "laughing", "whispering", "excited"
};

export type SoundCue = {
  type: 'intro' | 'transition' | 'outro' | 'ambient';
  prompt: string; // text prompt for sound effect generation
  durationSeconds: number;
  insertAfterTurn: number; // index of the turn after which to insert this cue
};

export type GeneratedReference = {
  number: number;
  title: string;
  authors: string[];
  year: number | null;
  url: string | null;
  type: 'WEB' | 'PAPER' | 'BOOK' | 'ARTICLE' | 'VIDEO' | 'REPORT';
  publisher: string | null;
  doi: string | null;
};

/**
 * Normalize references from AI output — authors may arrive as a
 * comma-separated string instead of string[].
 */
function normalizeReferences(
  refs: Array<Record<string, unknown>>
): GeneratedReference[] {
  return refs.map((ref) => ({
    ...ref,
    authors: Array.isArray(ref.authors)
      ? (ref.authors as string[])
      : typeof ref.authors === 'string'
        ? (ref.authors as string).split(/,\s*/)
        : [],
  })) as GeneratedReference[];
}

/**
 * Generate a 2-voice podcast script from discovery metadata.
 * Produces natural, immersive dialogue with delivery directions, sound effect cues,
 * and inline citations backed by real references.
 */
const AUDIENCE_GUIDANCE: Record<string, string> = {
  kids: 'This podcast is for CHILDREN aged 6-10. Use simple vocabulary and short sentences. Rely on playful analogies, fun comparisons, and real-world examples a child would know. Keep energy high and enthusiastic. Absolutely no scary, violent, or mature content. Keep segments punchy and fast-paced — kids lose attention quickly.',
  teens:
    "This podcast is for TEENAGERS aged 11-16. Use relatable references (social media, gaming, school life). Don't condescend — teens can handle complex topics but keep language accessible. Light humor works well. You can discuss challenging topics but frame them age-appropriately.",
  family:
    'This podcast is FAMILY-FRIENDLY — safe for all ages in the room together. Use inclusive language, no profanity or explicit content. Explain concepts so both kids and adults stay engaged. Think "dinner table conversation" — interesting for everyone.',
  general: 'Standard adult content with no special restrictions. This is the default audience.',
  mature: MATURE_AUDIENCE_GUIDANCE,
};

export interface SourceMetadata {
  title?: string;
  author?: string;
  publishedDate?: string;
  siteName?: string;
  wordCount?: number;
  sourceType?: string;
}

export async function generateScript(params: {
  topic: string;
  depth: string;
  audienceLevel: string;
  audience?: string;
  focusAreas: string[];
  tone: string;
  durationTarget: number;
  sourceContent?: string;
  sourceMetadata?: SourceMetadata;
  apiKeyOverride?: string;
  model?: string;
}): Promise<{
  turns: ScriptTurn[];
  soundCues: SoundCue[];
  references: GeneratedReference[];
  markdown: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}> {
  const systemPrompt = `You are a world-class podcast script writer for Sotto. Generate immersive, addictive 2-voice podcast scripts that listeners can't stop playing.

## Speakers:
- HOST: Warm, curious, asks great questions, guides the conversation. Represents the listener. Reacts naturally — laughs, expresses surprise, interjects with short reactions.
- EXPERT: Knowledgeable, vivid storyteller, uses analogies, examples, and occasionally humor. Explains complex topics in ways that create "aha" moments.

## Voice & Delivery Guidelines:
- Write dialogue that sounds like a REAL conversation, not a lecture
- Include natural speech patterns: "So here's the thing...", "Wait, really?", "That's fascinating because..."
- Let speakers occasionally overlap in energy — the HOST can finish the EXPERT's thought, or react mid-explanation
- Build tension and payoffs: set up interesting questions, then deliver satisfying answers
- Use the "cliffhanger" technique between segments: end a thought with intrigue before the next turn picks it up

## Audio Expression Tags:
For richer vocal expression, embed inline audio tags in the turn TEXT:
- [laughs], [chuckles] — genuine amusement
- [sighs] — exasperation, relief, or contemplation
- [whispers] — emphasis or dramatic effect
- [gasps] — surprise or shock
Use SPARINGLY — at most 1-2 per turn, only when the emotion genuinely fits.
Example: "Wait, really? [laughs] That's incredible."
These go inline in the text field, NOT in the direction field.
You may still use parenthetical directions like (leaning in), (thoughtful pause) in the direction field for context.
- ${params.tone === 'casual' ? 'Keep it light, use humor freely, casual language, pop culture references' : ''}
- ${params.tone === 'professional' ? 'Maintain a professional but warm tone, with occasional humor to keep it engaging' : ''}
- ${params.tone === 'socratic' ? 'Use the Socratic method — HOST asks probing questions that build on each other, EXPERT guides discovery' : ''}
- ${params.tone === 'storytelling' ? 'Frame everything as a narrative — characters, conflict, resolution. Make facts feel like plot points.' : ''}
${params.depth === 'eli5' ? `## ELI5 Depth — Explain Like I'm 5:
- Use the simplest possible language — imagine explaining to a curious 5-year-old
- Rely heavily on analogies, metaphors, and comparisons to everyday objects/experiences
- Break complex ideas into tiny, digestible pieces
- Use lots of "imagine...", "it's kind of like...", "you know how..."
- Keep sentences short and punchy
- Avoid jargon entirely — if a technical term is unavoidable, immediately explain it in plain words
- Make it fun and engaging — wonder and curiosity over precision
- It's OK to simplify — accuracy matters less than comprehension at this depth` : ''}

## Audience: ${params.audience || 'general'}
${AUDIENCE_GUIDANCE[params.audience || 'general'] || AUDIENCE_GUIDANCE.general}

## Pacing for Maximum Engagement:
- Start with a HOOK in the first 15 seconds — a surprising fact, provocative question, or bold claim
- Alternate between high-energy and reflective moments
- Every 2-3 minutes, introduce a new angle or surprising connection
- Target exactly ${params.durationTarget} minutes. Your script MUST be between ${wordCountBounds(params.durationTarget).min} and ${wordCountBounds(params.durationTarget).max} words (${minutesToWords(params.durationTarget)} ideal). Scripts outside this range will be rejected.
- Audience level: ${params.audienceLevel}
- Focus areas: ${params.focusAreas.join(', ')}

## Inline Citations:
You MUST include inline citations in the dialogue using [N] notation (e.g. [1], [2]):
- Only cite REAL, verifiable sources — published papers, books, reputable news outlets, official reports
- Use 3-15 citations depending on depth level (deep_dive: 10-15, standard: 5-10, quick_overview: 3-8, eli5: 3-8)
- HOST introduces citations conversationally: "I read that researchers at MIT found..." [3]
- EXPERT cites to back claims: "According to a 2023 study in Nature [4], the results showed..."
- Grouped citations are fine: [1,2] when multiple sources support one claim
- Do NOT invent fake citations. Every citation MUST reference a real, verifiable source. Do NOT cite Wikipedia, personal blogs, social media, or content farms. Only cite: peer-reviewed journals, published books, government reports (.gov), academic institutions (.edu), and established news outlets (Reuters, AP, BBC, NYT, etc). Each non-obvious factual claim should be supported by at least 3 independent sources

## Sound Effect Cues:
Include sound effect suggestions as [SFX: description] markers at natural transition points:
- [SFX: warm podcast intro jingle, 3s] at the very start
- [SFX: subtle transition whoosh, 1s] between major topic shifts
- [SFX: gentle outro music, 4s] at the end
- Use sparingly (3-5 per episode max) — they should enhance, not distract

## Output Format:
Return a JSON object with three arrays:
{
  "turns": [
    {"speaker": "HOST", "text": "...", "direction": "energetic"},
    {"speaker": "EXPERT", "text": "According to a 2023 study [1], ...", "direction": "thoughtful"}
  ],
  "soundCues": [
    {"type": "intro", "prompt": "warm upbeat podcast intro jingle with soft chimes", "durationSeconds": 3, "insertAfterTurn": -1},
    {"type": "transition", "prompt": "subtle whoosh transition sound", "durationSeconds": 1, "insertAfterTurn": 8},
    {"type": "outro", "prompt": "gentle melodic podcast outro with fade", "durationSeconds": 4, "insertAfterTurn": 20}
  ],
  "references": [
    {"number": 1, "title": "Study Title", "authors": ["Author A", "Author B"], "year": 2023, "url": "https://...", "type": "PAPER", "publisher": "Nature", "doi": "10.1234/..."},
    {"number": 2, "title": "Book Title", "authors": ["Author C"], "year": 2021, "url": null, "type": "BOOK", "publisher": "Publisher Name", "doi": null}
  ]
}

The "direction" field is optional — only include it when the delivery should notably shift from conversational default.
The "insertAfterTurn" field is the 0-based index; use -1 to insert before the first turn.
The "references" array must contain an entry for every [N] cited in the turns. Type must be one of: WEB, PAPER, BOOK, ARTICLE, VIDEO, REPORT.

## Web Search:
You have access to web search. Use it to:
- Find current events, recent news, and up-to-date information
- Verify facts and find accurate statistics
- Discover recent studies, reports, and publications
- Ground the podcast in real, current information rather than outdated training data
For time-sensitive topics (current events, "what happened today/this week", latest developments), ALWAYS search the web first before writing the script.

Only return the JSON object, nothing else.${CONTENT_SAFETY_INSTRUCTIONS}`;

  const userMessage = params.sourceContent
    ? `Topic: ${params.topic}\nDepth: ${params.depth}\n\n${formatSourceBlock(params.sourceContent, params.sourceMetadata)}`
    : `Topic: ${params.topic}\nDepth: ${params.depth}`;

  const response = await generateResponse(systemPrompt, [{ role: 'user', content: userMessage }], {
    maxTokens: 12288,
    apiKeyOverride: params.apiKeyOverride,
    model: params.model,
    tools: [WEB_SEARCH_TOOL],
  });

  let parsed: { turns: ScriptTurn[]; soundCues: SoundCue[]; references: GeneratedReference[] };
  try {
    const rawParsed = JSON.parse(response.content);
    // Handle backward compat: if response is just an array, wrap it
    if (Array.isArray(rawParsed)) {
      parsed = { turns: rawParsed, soundCues: [], references: [] };
    } else {
      parsed = rawParsed;
    }
  } catch {
    // Try to extract JSON from response
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      // Fallback: try parsing as just an array of turns (backward compat)
      const arrayMatch = response.content.match(/\[[\s\S]*\]/);
      const turns = arrayMatch ? JSON.parse(arrayMatch[0]) : [];
      parsed = { turns, soundCues: [], references: [] };
    }
  }

  // Ensure defaults
  if (!parsed.soundCues || parsed.soundCues.length === 0) {
    parsed.soundCues = [
      {
        type: 'intro',
        prompt: 'warm podcast intro jingle with soft chimes',
        durationSeconds: 3,
        insertAfterTurn: -1,
      },
      {
        type: 'outro',
        prompt: 'gentle melodic podcast outro with fade out',
        durationSeconds: 4,
        insertAfterTurn: parsed.turns.length - 1,
      },
    ];
  }

  parsed.references = normalizeReferences(
    (parsed.references as Array<Record<string, unknown>>) || []
  );

  // Generate markdown version with delivery directions
  const markdown = parsed.turns
    .map((turn) => {
      const direction = turn.direction ? ` _(${turn.direction})_` : '';
      return `**${turn.speaker}:**${direction} ${turn.text}`;
    })
    .join('\n\n');

  return {
    turns: parsed.turns,
    soundCues: parsed.soundCues,
    references: parsed.references,
    markdown,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    model: response.model,
  };
}

/**
 * Regenerate a script incorporating verification feedback.
 * Used by the script-verification worker when the "teacher" agent rejects a script.
 */
export async function generateScriptWithFeedback(params: {
  topic: string;
  depth: string;
  audienceLevel: string;
  audience?: string;
  focusAreas: string[];
  tone: string;
  durationTarget: number;
  sourceContent?: string;
  sourceMetadata?: SourceMetadata;
  previousScript: ScriptTurn[];
  previousReferences: GeneratedReference[];
  verificationFeedback: string;
  apiKeyOverride?: string;
  model?: string;
}): Promise<{
  turns: ScriptTurn[];
  soundCues: SoundCue[];
  references: GeneratedReference[];
  markdown: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}> {
  const systemPrompt = `You are a world-class podcast script writer for Sotto. You are REVISING a previously generated script based on fact-checking feedback.

## REVISION INSTRUCTIONS:
A fact-checking agent reviewed your previous script and found issues. You MUST address every piece of feedback below. Do NOT ignore any feedback item.

Key rules for this revision:
1. Fix ALL unsourced claims — add real citations or remove the claim
2. Replace ALL unreliable sources (Wikipedia, blogs, social media) with peer-reviewed journals, books, government reports, or established news outlets
3. Ensure every non-obvious factual claim has at least 1 citation, ideally 3+ independent sources
4. If a claim cannot be properly sourced, remove it and replace with a well-sourced alternative
5. Maintain the conversational quality and engagement of the original script

## Speakers:
- HOST: Warm, curious, asks great questions, guides the conversation
- EXPERT: Knowledgeable, vivid storyteller, uses analogies and examples

## Voice & Delivery Guidelines:
- Write dialogue that sounds like a REAL conversation, not a lecture
- Include natural speech patterns and delivery directions in parentheses when tone shifts

## Audio Expression Tags:
For richer vocal expression, embed inline audio tags in the turn TEXT:
- [laughs], [chuckles] — genuine amusement
- [sighs] — exasperation, relief, or contemplation
- [whispers] — emphasis or dramatic effect
- [gasps] — surprise or shock
Use SPARINGLY — at most 1-2 per turn, only when the emotion genuinely fits.
These go inline in the text field, NOT in the direction field.

- ${params.tone === 'casual' ? 'Keep it light, use humor freely, casual language' : ''}
- ${params.tone === 'professional' ? 'Maintain a professional but warm tone' : ''}
- ${params.tone === 'socratic' ? 'Use the Socratic method — probing questions building on each other' : ''}
- ${params.tone === 'storytelling' ? 'Frame everything as narrative — characters, conflict, resolution' : ''}

## Audience: ${params.audience || 'general'}
${AUDIENCE_GUIDANCE[params.audience || 'general'] || AUDIENCE_GUIDANCE.general}

## Pacing:
- Target exactly ${params.durationTarget} minutes. Your script MUST be between ${wordCountBounds(params.durationTarget).min} and ${wordCountBounds(params.durationTarget).max} words (${minutesToWords(params.durationTarget)} ideal). Scripts outside this range will be rejected.
- Audience level: ${params.audienceLevel}
- Focus areas: ${params.focusAreas.join(', ')}

## Citation Requirements:
- Do NOT invent fake citations. Every citation MUST reference a real, verifiable source.
- Do NOT cite Wikipedia, personal blogs, social media, or content farms.
- Only cite: peer-reviewed journals, published books, government reports (.gov), academic institutions (.edu), and established news outlets (Reuters, AP, BBC, NYT, etc).
- Each non-obvious factual claim should be supported by at least 3 independent sources.
- Use [N] notation for inline citations.

## Sound Effect Cues:
Include [SFX: description] markers at natural transition points (3-5 per episode max).

## Web Search:
You have access to web search. Use it to verify facts, find accurate statistics, and discover current information to improve the script.

## Output Format:
Return a JSON object with three arrays: "turns", "soundCues", "references" (same format as original generation).
Only return the JSON object, nothing else.${CONTENT_SAFETY_INSTRUCTIONS}`;

  const previousScriptText = params.previousScript
    .map((t, i) => `[${i}] ${t.speaker}: ${t.text}`)
    .join('\n');

  const previousRefsText = params.previousReferences
    .map((r) => `[${r.number}] "${r.title}" (${r.type}) — ${r.url || 'no url'}`)
    .join('\n');

  const userMessage = `Topic: ${params.topic}
Depth: ${params.depth}

## FACT-CHECKER FEEDBACK:
${params.verificationFeedback}

## PREVIOUS SCRIPT (to revise):
${previousScriptText}

## PREVIOUS REFERENCES:
${previousRefsText}

${params.sourceContent ? `\n${formatSourceBlock(params.sourceContent, params.sourceMetadata)}` : ''}

Revise the script addressing ALL feedback. Return JSON only.`;

  const response = await generateResponse(systemPrompt, [{ role: 'user', content: userMessage }], {
    maxTokens: 12288,
    apiKeyOverride: params.apiKeyOverride,
    model: params.model,
    tools: [WEB_SEARCH_TOOL],
  });

  let parsed: { turns: ScriptTurn[]; soundCues: SoundCue[]; references: GeneratedReference[] };
  try {
    const rawParsed = JSON.parse(response.content);
    if (Array.isArray(rawParsed)) {
      parsed = { turns: rawParsed, soundCues: [], references: [] };
    } else {
      parsed = rawParsed;
    }
  } catch {
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      const arrayMatch = response.content.match(/\[[\s\S]*\]/);
      const turns = arrayMatch ? JSON.parse(arrayMatch[0]) : [];
      parsed = { turns, soundCues: [], references: [] };
    }
  }

  if (!parsed.soundCues || parsed.soundCues.length === 0) {
    parsed.soundCues = [
      {
        type: 'intro',
        prompt: 'warm podcast intro jingle with soft chimes',
        durationSeconds: 3,
        insertAfterTurn: -1,
      },
      {
        type: 'outro',
        prompt: 'gentle melodic podcast outro with fade out',
        durationSeconds: 4,
        insertAfterTurn: parsed.turns.length - 1,
      },
    ];
  }

  parsed.references = normalizeReferences(
    (parsed.references as Array<Record<string, unknown>>) || []
  );

  const markdown = parsed.turns
    .map((turn) => {
      const direction = turn.direction ? ` _(${turn.direction})_` : '';
      return `**${turn.speaker}:**${direction} ${turn.text}`;
    })
    .join('\n\n');

  return {
    turns: parsed.turns,
    soundCues: parsed.soundCues,
    references: parsed.references,
    markdown,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    model: response.model,
  };
}

const SOURCE_CONTENT_LIMIT = 20000;

function formatSourceBlock(content: string, metadata?: SourceMetadata): string {
  const truncated = content.substring(0, SOURCE_CONTENT_LIMIT);

  if (metadata && (metadata.title || metadata.author || metadata.publishedDate || metadata.siteName)) {
    const parts = [
      metadata.title && `Title: ${metadata.title}`,
      metadata.author && `Author: ${metadata.author}`,
      metadata.publishedDate && `Published: ${metadata.publishedDate}`,
      metadata.siteName && `Source: ${metadata.siteName}`,
    ].filter(Boolean);
    return `Source material:\n${parts.join(' | ')}\nContent:\n${truncated}`;
  }

  return `Source material:\n${truncated}`;
}
