import { createAIProvider } from './providers/ai';
import { CONTENT_SAFETY_INSTRUCTIONS } from './safety-prompts';
import { VOICE_REALISM_INSTRUCTIONS } from './voice-realism-prompts';
import { loadPrompt, loadAndRender } from './prompt-loader';
import { minutesToWords, wordCountBounds } from './duration';
import { generatedScriptSchema } from './validations';
import { logger } from './logger';
import type { BiasAnalysis } from './media-bias';


/** Extract the first complete JSON object or array from a string containing surrounding text. */
function extractFirstJson(text: string, open: '{' | '['): string {
  const close = open === '{' ? '}' : ']';
  const trimmed = text.trim();
  try { JSON.parse(trimmed); return trimmed; } catch {}
  const start = text.indexOf(open);
  if (start === -1) throw new Error(`No JSON ${open === '{' ? 'object' : 'array'} found in response`);
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === open) depth++;
    if (ch === close && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error('Unbalanced JSON in response');
}

/**
 * Sanitize common LLM JSON formatting issues:
 * - Strip markdown code fences (```json ... ```)
 * - Remove [N] index annotations from array elements (e.g., [0] "text" → "text")
 */
function sanitizeLlmJson(text: string): string {
  let cleaned = text.trim();
  // Strip markdown code fences
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  // Remove [N] index annotations before values (e.g., `[0] "HOST: ..."` → `"HOST: ..."`)
  cleaned = cleaned.replace(/\[\d+\]\s*/g, '');
  return cleaned;
}

/**
 * Last-resort: extract SPEAKER: text patterns from raw LLM output when JSON parsing fails entirely.
 * Returns null if fewer than 2 turns found (not enough for a conversation).
 */
function extractTurnsFromText(text: string): ScriptTurn[] | null {
  // Match patterns like "HOST: text" or "EXPERT: text" at line starts (with optional quotes/prefixes)
  const turnPattern = /^\s*(?:[-*•]\s*)?(?:"|')?([A-Z][A-Z\s]*?)(?:"|')?\s*:\s*(.+)/gm;
  const turns: ScriptTurn[] = [];
  let match;
  while ((match = turnPattern.exec(text)) !== null) {
    const speaker = match[1].trim();
    let turnText = match[2].trim();
    // Strip trailing quotes/commas from JSON-like remnants
    turnText = turnText.replace(/[",]+$/, '').trim();
    if (speaker && turnText && turnText.length > 10) {
      turns.push({ speaker, text: turnText });
    }
  }
  return turns.length >= 2 ? turns : null;
}

export type ScriptTurn = {
  speaker: string;
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

export type ScriptPlace = {
  name: string;
  modernName?: string | null;
  coordinates?: [number, number] | null;
  yearHint?: number | null;
  significance?: string | null;
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
 * Deduplicate references by content identity (DOI, URL, or normalized title).
 * Returns deduplicated references renumbered from 1, and a map from old → new
 * numbers so callers can remap `[N]` citation markers in the script text.
 */
function deduplicateReferences(refs: GeneratedReference[]): {
  references: GeneratedReference[];
  numberMap: Map<number, number>;
} {
  if (refs.length === 0) return { references: [], numberMap: new Map() };

  // Build a content key for each reference
  function contentKey(ref: GeneratedReference): string {
    if (ref.doi) return `doi:${ref.doi.toLowerCase().trim()}`;
    if (ref.url) return `url:${ref.url.toLowerCase().trim()}`;
    return `title:${ref.title.toLowerCase().trim()}`;
  }

  const seen = new Map<string, number>(); // content key → kept reference's NEW number
  const kept: GeneratedReference[] = [];
  const numberMap = new Map<number, number>(); // old number → new number

  for (const ref of refs) {
    const key = contentKey(ref);
    const existingNewNumber = seen.get(key);

    if (existingNewNumber !== undefined) {
      // Duplicate — map old number to the kept reference's new number
      numberMap.set(ref.number, existingNewNumber);
    } else {
      const newNumber = kept.length + 1;
      seen.set(key, newNumber);
      numberMap.set(ref.number, newNumber);
      kept.push({ ...ref, number: newNumber });
    }
  }

  return { references: kept, numberMap };
}

/**
 * Remap `[N]` citation markers in script turns using a number map.
 * Handles single `[1]` and comma-separated `[1,3]` patterns.
 */
function remapCitations(turns: ScriptTurn[], numberMap: Map<number, number>): ScriptTurn[] {
  // Check if any numbers actually changed
  let hasChanges = false;
  for (const [old, nu] of numberMap) {
    if (old !== nu) { hasChanges = true; break; }
  }
  if (!hasChanges) return turns;

  return turns.map((turn) => ({
    ...turn,
    text: turn.text.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (_match, inner: string) => {
      const remapped = inner
        .split(',')
        .map((s) => {
          const n = parseInt(s.trim(), 10);
          return numberMap.get(n) ?? n;
        })
        // Deduplicate numbers that now map to the same reference
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .sort((a, b) => a - b);
      return `[${remapped.join(',')}]`;
    }),
  }));
}

const VALID_REF_TYPES = new Set(['WEB', 'PAPER', 'BOOK', 'ARTICLE', 'VIDEO', 'REPORT']);
const REF_TYPE_ALIASES: Record<string, string> = {
  JOURNAL: 'PAPER', journal: 'PAPER', paper: 'PAPER',
  WEBPAGE: 'WEB', webpage: 'WEB', web: 'WEB', website: 'WEB', URL: 'WEB',
  NEWS: 'ARTICLE', article: 'ARTICLE', news: 'ARTICLE',
  book: 'BOOK', TEXTBOOK: 'BOOK',
  video: 'VIDEO', YOUTUBE: 'VIDEO',
  report: 'REPORT', GOVERNMENT: 'REPORT',
};

function coerceRefType(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const upper = raw.toUpperCase();
  if (VALID_REF_TYPES.has(upper)) return upper;
  return REF_TYPE_ALIASES[raw] ?? REF_TYPE_ALIASES[upper] ?? null;
}

/**
 * Pre-validation coercion: fix common AI output mistakes before Zod validates.
 * Maps alternate key names, fills missing nullable fields with null, and drops
 * unsalvageable items — so a few malformed entries don't crash the whole pipeline.
 */
function coerceScriptOutput(raw: Record<string, unknown>): Record<string, unknown> {
  const result = { ...raw };

  // --- turns: map alternate key names the AI might use ---
  if (!Array.isArray(result.turns) || result.turns.length === 0) {
    const TURN_ALIASES = ['dialogue', 'dialog', 'conversation', 'script', 'lines', 'segments', 'entries'];
    for (const alias of TURN_ALIASES) {
      if (Array.isArray(result[alias]) && (result[alias] as unknown[]).length > 0) {
        result.turns = result[alias];
        delete result[alias];
        break;
      }
    }
  }

  // --- turns: coerce string entries like "HOST: text" into {speaker, text} objects ---
  if (Array.isArray(result.turns)) {
    result.turns = (result.turns as unknown[]).map((turn) => {
      if (typeof turn === 'string') {
        const colonIdx = turn.indexOf(':');
        if (colonIdx > 0 && colonIdx < 30) {
          return {
            speaker: turn.substring(0, colonIdx).trim(),
            text: turn.substring(colonIdx + 1).trim(),
          };
        }
        return { speaker: 'HOST', text: turn.trim() };
      }
      return turn;
    });
  }

  // --- soundCues: map alternate key names, drop incomplete items ---
  if (Array.isArray(result.soundCues)) {
    result.soundCues = (result.soundCues as Record<string, unknown>[])
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        return {
          type: item.type ?? item.cueType ?? item.cue_type,
          prompt: item.prompt ?? item.description ?? item.text,
          durationSeconds:
            item.durationSeconds ?? item.duration_seconds ?? item.duration,
          insertAfterTurn:
            item.insertAfterTurn ?? item.insert_after_turn ?? item.afterTurn,
        };
      })
      .filter(
        (item) =>
          item !== null &&
          item.type !== undefined &&
          item.prompt !== undefined &&
          item.durationSeconds !== undefined &&
          item.insertAfterTurn !== undefined
      );
  }

  // --- references: map alternate key names, fill nullable fields ---
  if (Array.isArray(result.references)) {
    result.references = (result.references as Record<string, unknown>[])
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const title = item.title ?? item.name;
        if (!title) return null; // unsalvageable without a title

        const authors = item.authors ?? item.author;
        return {
          number: item.number ?? item.num ?? item.ref_number ?? item.id,
          title,
          authors: authors !== undefined
            ? (Array.isArray(authors) ? authors : typeof authors === 'string' ? [authors] : [])
            : [],
          year: item.year ?? null,
          url: item.url ?? item.link ?? item.source_url ?? null,
          type: coerceRefType(item.type ?? item.sourceType ?? item.source_type) ?? 'WEB',
          publisher:
            item.publisher ?? item.publisher_name ?? item.source ?? null,
          doi: item.doi ?? null,
        };
      })
      .filter(Boolean);

    // Auto-assign numbers if they're all missing
    const refs = result.references as Record<string, unknown>[];
    if (refs.length > 0 && refs.every((r) => r.number == null)) {
      refs.forEach((r, i) => { r.number = i + 1; });
    }
  }

  return result;
}

/**
 * Generate a 2-voice podcast script from discovery metadata.
 * Produces natural, immersive dialogue with delivery directions, sound effect cues,
 * and inline citations backed by real references.
 */
const VALID_AUDIENCES = new Set(['kids', 'teens', 'family', 'general', 'mature']);

function getAudienceGuidance(audience: string | undefined): string {
  const key = audience && VALID_AUDIENCES.has(audience) ? audience : 'general';
  return loadPrompt(`shared/audience/${key}.md`);
}

const TONE_GUIDANCE_MAIN: Record<string, string> = {
  casual: '- Keep it light, use humor freely, casual language, pop culture references',
  professional: '- Maintain a professional but warm tone, with occasional humor to keep it engaging',
  socratic: '- Use the Socratic method — HOST asks probing questions that build on each other, EXPERT guides discovery',
  storytelling: '- Frame everything as a narrative — characters, conflict, resolution. Make facts feel like plot points.',
};

const TONE_GUIDANCE_REVISION: Record<string, string> = {
  casual: '- Keep it light, use humor freely, casual language',
  professional: '- Maintain a professional but warm tone',
  socratic: '- Use the Socratic method — probing questions building on each other',
  storytelling: '- Frame everything as narrative — characters, conflict, resolution',
};

export interface SourceMetadata {
  title?: string;
  author?: string;
  publishedDate?: string;
  siteName?: string;
  wordCount?: number;
  sourceType?: string;
  biasAnalysis?: BiasAnalysis;
}

/**
 * Render bias guidance prompt when source is politically biased.
 * Returns empty string for non-political topics, center sources, or missing data.
 */
function renderBiasGuidance(sourceMetadata?: SourceMetadata): string {
  const bias = sourceMetadata?.biasAnalysis;
  if (!bias?.isPolitical || !bias.sourceBias || bias.sourceBias === 'center' || bias.sourceBias === 'pro-science') {
    return '';
  }
  return '\n\n' + loadAndRender('shared/bias-guidance.md', {
    SOURCE_NAME: bias.sourceName ?? 'the source',
    SOURCE_BIAS: bias.sourceBias,
  });
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
  speakers?: Array<{ name: string; description: string }>;
  apiKeyOverride?: string;
  model?: string;
  provider?: string;
  webSearchEnabled?: boolean;
  mode?: 'standard' | 'demo';
  source?: string;
}): Promise<{
  turns: ScriptTurn[];
  soundCues: SoundCue[];
  references: GeneratedReference[];
  places: ScriptPlace[];
  markdown: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}> {
  const speakers = params.speakers ?? [
    { name: 'HOST', description: 'Warm, curious, asks great questions, guides the conversation. Represents the listener. Reacts naturally — laughs, expresses surprise, interjects with short reactions.' },
    { name: 'EXPERT', description: 'Knowledgeable, vivid storyteller, uses analogies, examples, and occasionally humor. Explains complex topics in ways that create "aha" moments.' },
  ];
  const speakerCount = speakers.length;
  const speakerSection = speakers.map((s) => `- ${s.name}: ${s.description}`).join('\n');

  const voiceDeliveryGuidelines = speakerCount === 1
    ? loadPrompt('generation/monologue-guidelines.md')
    : loadPrompt('generation/dialogue-guidelines.md');

  const eli5Section = params.depth === 'eli5'
    ? loadPrompt('generation/eli5-section.md')
    : '';

  // Use briefing-specific prompt for BRIEFING source
  const systemPrompt = params.source === 'BRIEFING'
    ? loadAndRender('generation/briefing-script.md', {
        VOICE_REALISM: VOICE_REALISM_INSTRUCTIONS,
        CONTENT_SAFETY: CONTENT_SAFETY_INSTRUCTIONS,
        DURATION_TARGET: String(params.durationTarget),
        WORD_COUNT_MIN: String(wordCountBounds(params.durationTarget).min),
        WORD_COUNT_MAX: String(wordCountBounds(params.durationTarget).max),
        WORD_COUNT_IDEAL: String(minutesToWords(params.durationTarget)),
        SOURCE_ARTICLES: params.sourceContent || '',
      })
    : loadAndRender('generation/script-generator.md', {
        SPEAKER_COUNT: String(speakerCount),
        SPEAKER_SECTION: speakerSection,
        VOICE_DELIVERY_GUIDELINES: voiceDeliveryGuidelines,
        VOICE_REALISM: VOICE_REALISM_INSTRUCTIONS,
        TONE_GUIDANCE: TONE_GUIDANCE_MAIN[params.tone] || '',
        ELI5_SECTION: eli5Section,
        AUDIENCE: params.audience || 'general',
        AUDIENCE_GUIDANCE: getAudienceGuidance(params.audience),
        DURATION_TARGET: String(params.durationTarget),
        WORD_COUNT_MIN: String(wordCountBounds(params.durationTarget).min),
        WORD_COUNT_MAX: String(wordCountBounds(params.durationTarget).max),
        WORD_COUNT_IDEAL: String(minutesToWords(params.durationTarget)),
        AUDIENCE_LEVEL: params.audienceLevel,
        FOCUS_AREAS: params.focusAreas.join(', '),
        HOST_SPEAKER: speakers[0].name,
        EXPERT_SPEAKER: speakers.length > 1 ? speakers[1].name : speakers[0].name,
        BIAS_GUIDANCE: renderBiasGuidance(params.sourceMetadata),
        CONTENT_SAFETY: CONTENT_SAFETY_INSTRUCTIONS,
      });

  const userMessage = params.sourceContent
    ? `Topic: ${params.topic}\nDepth: ${params.depth}\n\n${formatSourceBlock(params.sourceContent, params.sourceMetadata)}`
    : `Topic: ${params.topic}\nDepth: ${params.depth}`;

  const ai = createAIProvider(params.provider);
  const response = await ai.generateResponse(systemPrompt, [{ role: 'user', content: userMessage }], {
    maxTokens: 12288,
    apiKeyOverride: params.apiKeyOverride,
    model: params.model,
    useWebSearch: params.webSearchEnabled !== false,
  });

  return parseScriptResponse(response);
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
  speakers?: Array<{ name: string; description: string }>;
  previousScript: ScriptTurn[];
  previousReferences: GeneratedReference[];
  verificationFeedback: string;
  apiKeyOverride?: string;
  model?: string;
  provider?: string;
  webSearchEnabled?: boolean;
}): Promise<{
  turns: ScriptTurn[];
  soundCues: SoundCue[];
  references: GeneratedReference[];
  places: ScriptPlace[];
  markdown: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}> {
  const feedbackSpeakers = params.speakers ?? [
    { name: 'HOST', description: 'Warm, curious, asks great questions, guides the conversation' },
    { name: 'EXPERT', description: 'Knowledgeable, vivid storyteller, uses analogies and examples' },
  ];
  const feedbackSpeakerSection = feedbackSpeakers.map((s) => `- ${s.name}: ${s.description}`).join('\n');

  const systemPrompt = loadAndRender('generation/script-revision-factcheck.md', {
    SPEAKER_SECTION: feedbackSpeakerSection,
    VOICE_REALISM: VOICE_REALISM_INSTRUCTIONS,
    TONE_GUIDANCE: TONE_GUIDANCE_REVISION[params.tone] || '',
    AUDIENCE: params.audience || 'general',
    AUDIENCE_GUIDANCE: getAudienceGuidance(params.audience),
    DURATION_TARGET: String(params.durationTarget),
    WORD_COUNT_MIN: String(wordCountBounds(params.durationTarget).min),
    WORD_COUNT_MAX: String(wordCountBounds(params.durationTarget).max),
    WORD_COUNT_IDEAL: String(minutesToWords(params.durationTarget)),
    AUDIENCE_LEVEL: params.audienceLevel,
    FOCUS_AREAS: params.focusAreas.join(', '),
    BIAS_GUIDANCE: renderBiasGuidance(params.sourceMetadata),
    CONTENT_SAFETY: CONTENT_SAFETY_INSTRUCTIONS,
  });

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

  const ai = createAIProvider(params.provider);
  const response = await ai.generateResponse(systemPrompt, [{ role: 'user', content: userMessage }], {
    maxTokens: 12288,
    apiKeyOverride: params.apiKeyOverride,
    model: params.model,
    useWebSearch: params.webSearchEnabled !== false,
  });

  return parseScriptResponse(response);
}

/**
 * Regenerate a script incorporating user feedback (general notes, per-turn comments, highlights).
 * Unlike generateScriptWithFeedback() (which handles fact-checker feedback with strict citation rules),
 * this function uses a lighter system prompt focused on addressing user preferences.
 */
export async function generateScriptWithUserFeedback(params: {
  topic: string;
  depth: string;
  audienceLevel: string;
  audience?: string;
  focusAreas: string[];
  tone: string;
  durationTarget: number;
  sourceContent?: string;
  sourceMetadata?: SourceMetadata;
  speakers?: Array<{ name: string; description: string }>;
  previousScript: Array<{ speaker: string; text: string; direction?: string }>;
  previousReferences: Array<{ number: number; title: string; authors?: string; year?: number; url?: string; type: string; publisher?: string; doi?: string }>;
  userFeedback: string;
  apiKeyOverride?: string;
  model?: string;
  provider?: string;
  webSearchEnabled?: boolean;
}): Promise<{
  turns: ScriptTurn[];
  soundCues: SoundCue[];
  references: GeneratedReference[];
  places: ScriptPlace[];
  markdown: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}> {
  const feedbackSpeakers = params.speakers ?? [
    { name: 'HOST', description: 'Warm, curious, asks great questions, guides the conversation' },
    { name: 'EXPERT', description: 'Knowledgeable, vivid storyteller, uses analogies and examples' },
  ];
  const feedbackSpeakerSection = feedbackSpeakers.map((s) => `- ${s.name}: ${s.description}`).join('\n');

  const systemPrompt = loadAndRender('generation/script-revision-user.md', {
    SPEAKER_SECTION: feedbackSpeakerSection,
    VOICE_REALISM: VOICE_REALISM_INSTRUCTIONS,
    TONE_GUIDANCE: TONE_GUIDANCE_REVISION[params.tone] || '',
    AUDIENCE: params.audience || 'general',
    AUDIENCE_GUIDANCE: getAudienceGuidance(params.audience),
    DURATION_TARGET: String(params.durationTarget),
    WORD_COUNT_MIN: String(wordCountBounds(params.durationTarget).min),
    WORD_COUNT_MAX: String(wordCountBounds(params.durationTarget).max),
    WORD_COUNT_IDEAL: String(minutesToWords(params.durationTarget)),
    AUDIENCE_LEVEL: params.audienceLevel,
    FOCUS_AREAS: params.focusAreas.join(', '),
    BIAS_GUIDANCE: renderBiasGuidance(params.sourceMetadata),
    CONTENT_SAFETY: CONTENT_SAFETY_INSTRUCTIONS,
  });

  const previousScriptText = params.previousScript
    .map((t, i) => `[${i}] ${t.speaker}: ${t.text}`)
    .join('\n');

  const previousRefsText = params.previousReferences
    .map((r) => `[${r.number}] "${r.title}" (${r.type}) — ${r.url || 'no url'}`)
    .join('\n');

  const userMessage = `Topic: ${params.topic}
Depth: ${params.depth}

## USER FEEDBACK:
${params.userFeedback}

## PREVIOUS SCRIPT (to revise):
${previousScriptText}

## PREVIOUS REFERENCES:
${previousRefsText}

${params.sourceContent ? `\n${formatSourceBlock(params.sourceContent, params.sourceMetadata)}` : ''}

Revise the script addressing ALL user feedback. Keep what works, change what the user flagged. Return JSON only.`;

  const ai = createAIProvider(params.provider);
  const response = await ai.generateResponse(systemPrompt, [{ role: 'user', content: userMessage }], {
    maxTokens: 12288,
    apiKeyOverride: params.apiKeyOverride,
    model: params.model,
    useWebSearch: params.webSearchEnabled !== false,
  });

  return parseScriptResponse(response);
}

/**
 * Shared response parser: JSON extraction, Zod validation, coercion,
 * sound cue defaults, reference dedup, and markdown generation.
 */
function parseScriptResponse(response: {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}): {
  turns: ScriptTurn[];
  soundCues: SoundCue[];
  references: GeneratedReference[];
  places: ScriptPlace[];
  markdown: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
} {
  let parsed: { turns: ScriptTurn[]; soundCues: SoundCue[]; references: GeneratedReference[]; places?: ScriptPlace[] };

  // Helper: attempt JSON parse with optional array-wrapping
  function tryParseJson(text: string): typeof parsed | null {
    try {
      const rawParsed = JSON.parse(text);
      if (Array.isArray(rawParsed)) return { turns: rawParsed, soundCues: [], references: [], places: [] };
      return rawParsed;
    } catch { return null; }
  }

  // Helper: extract first JSON object or array from text
  function tryExtractJson(text: string): typeof parsed | null {
    try {
      return JSON.parse(extractFirstJson(text, '{'));
    } catch {
      try {
        const turns = JSON.parse(extractFirstJson(text, '['));
        return { turns, soundCues: [], references: [], places: [] };
      } catch { return null; }
    }
  }

  // Phase 1: Try raw content directly
  parsed = tryParseJson(response.content)!;

  // Phase 2: Try extracting JSON from raw content (handles surrounding text)
  if (!parsed) parsed = tryExtractJson(response.content)!;

  // Phase 3: Sanitize (strip code fences, [N] indices) then retry
  if (!parsed) {
    const sanitized = sanitizeLlmJson(response.content);
    parsed = tryParseJson(sanitized)!;
    if (!parsed) parsed = tryExtractJson(sanitized)!;
  }

  // Phase 4: Last resort — regex-extract SPEAKER: text patterns
  if (!parsed) {
    const turns = extractTurnsFromText(response.content);
    if (turns) {
      logger.warn('Recovered script from non-JSON output via text extraction', {
        model: response.model,
        turnCount: String(turns.length),
      });
      parsed = { turns, soundCues: [], references: [], places: [] };
    }
  }

  if (!parsed) {
    logger.error('AI returned completely unparseable script output', {
      model: response.model,
      contentLength: String(response.content.length),
      contentPreview: response.content.substring(0, 500),
    });
    throw new Error(
      `AI returned unparseable script output (${response.content.length} chars, model: ${response.model}). ` +
      `Preview: ${response.content.substring(0, 200)}`
    );
  }

  const coerced = coerceScriptOutput(parsed as Record<string, unknown>);
  const validated = generatedScriptSchema.parse(coerced);

  if (!validated.soundCues || validated.soundCues.length === 0) {
    validated.soundCues = [
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
        insertAfterTurn: validated.turns.length - 1,
      },
    ];
  }

  const normalized = normalizeReferences(
    (validated.references as Array<Record<string, unknown>>) || []
  );
  const { references, numberMap } = deduplicateReferences(normalized);
  const turns = remapCitations(validated.turns, numberMap);

  const markdown = turns
    .map((turn) => {
      const direction = turn.direction ? ` _(${turn.direction})_` : '';
      return `**${turn.speaker}:**${direction} ${turn.text}`;
    })
    .join('\n\n');

  return {
    turns,
    soundCues: validated.soundCues as SoundCue[],
    references,
    places: (validated.places ?? []) as ScriptPlace[],
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
