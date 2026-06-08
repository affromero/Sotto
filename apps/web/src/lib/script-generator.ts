import { createAIProvider } from './providers/ai';
import { CONTENT_SAFETY_INSTRUCTIONS } from './safety-prompts';
import { VOICE_REALISM_INSTRUCTIONS } from './voice-realism-prompts';
import { loadPrompt, loadAndRender } from './prompt-loader';
import { minutesToWords, wordCountBounds } from './duration';
import { getMinReferenceCount, getMinSeriousRatio } from './script-verifier';
import { generatedScriptSchema } from './validations';
import { logger } from './logger';
import type { BiasAnalysis } from './media-bias';
import { LANGUAGE_DISPLAY } from '@sotto/shared';


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
  type: 'intro' | 'transition' | 'outro' | 'ambient' | 'laugh_track' | 'music_sting' | 'applause' | 'comedic_hit' | 'rim_shot';
  prompt: string; // text prompt for sound effect generation
  durationSeconds: number;
  insertAfterTurn: number; // index of the turn after which to insert this cue
  volume?: number; // 0.0-1.0, overrides type-based default
  fadeOutMs?: number; // milliseconds of fade-out at end of cue
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

export type GeneratedVocabularyEntry = {
  number: number;
  word: string;
  translation: string;
  partOfSpeech: string | null;
  pronunciation: string | null;
  exampleSentence: string | null;
  difficulty: string | null;
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

  return turns.map((turn) => {
    // Step 1: remap each citation marker
    let text = turn.text.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (_match, inner: string) => {
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
    });
    // Step 2: collapse adjacent duplicate markers (e.g. "[3] [3]" → "[3]")
    text = collapseAdjacentCitations(text);
    return { ...turn, text };
  });
}

/**
 * Collapse adjacent duplicate citation markers produced by remapping.
 * Only collapses when the second group adds no new numbers:
 * "[3] [3]" → "[3]", "[1,3] [3]" → "[1,3]", but "[1] [2]" stays as-is.
 */
function collapseAdjacentCitations(text: string): string {
  return text.replace(
    /\[(\d+(?:,\d+)*)\]\s*\[(\d+(?:,\d+)*)\]/g,
    (match, first: string, second: string) => {
      const firstSet = new Set(first.split(',').map(Number));
      const secondNums = second.split(',').map(Number);
      // Only collapse if every number in the second group is already in the first
      if (secondNums.every((n) => firstSet.has(n))) {
        return `[${first}]`;
      }
      return match;
    }
  );
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
          volume: item.volume ?? undefined,
          fadeOutMs: item.fadeOutMs ?? item.fade_out_ms ?? undefined,
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

  // --- vocabulary: coerce alternate key names ---
  if (Array.isArray(result.vocabulary)) {
    result.vocabulary = (result.vocabulary as Record<string, unknown>[])
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        return {
          number: item.number ?? item.num,
          word: item.word ?? item.term ?? item.vocab,
          translation: item.translation ?? item.meaning ?? item.definition,
          partOfSpeech: item.partOfSpeech ?? item.part_of_speech ?? item.pos ?? null,
          pronunciation: item.pronunciation ?? item.phonetic ?? null,
          exampleSentence: item.exampleSentence ?? item.example_sentence ?? item.example ?? null,
          difficulty: item.difficulty ?? item.level ?? null,
        };
      })
      .filter((item) => item !== null && item.word && item.translation);
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
  comedic: '- Write like a John Oliver editorial comedy segment: clear setup/punchline structure, callbacks to earlier jokes, absurdist escalation, and satirical commentary grounded in real facts. Balance humor with substance — jokes should illuminate the topic, not replace it. Include comedic tangents that circle back to the main point. Use [audience laughs] and [applause] tags after punchlines.',
  satirical: '- Deploy biting wit and irony to expose contradictions. Use the contrast between dry delivery and absurd subject matter. Employ rhetorical questions that answer themselves. Reference real headlines and public figures for satirical effect. Every joke should make a point. Use [audience laughs] sparingly for the sharpest lines.',
};

const TONE_GUIDANCE_REVISION: Record<string, string> = {
  casual: '- Keep it light, use humor freely, casual language',
  professional: '- Maintain a professional but warm tone',
  socratic: '- Use the Socratic method — probing questions building on each other',
  storytelling: '- Frame everything as narrative — characters, conflict, resolution',
  comedic: '- Maintain John Oliver-style comedy: setup/punchline, callbacks, absurdist escalation. Include [audience laughs] after punchlines.',
  satirical: '- Deploy biting wit and irony, dry delivery contrasting absurd subject matter. Use [audience laughs] sparingly.',
};

export interface SourceMetadata {
  title?: string;
  author?: string;
  publishedDate?: string;
  siteName?: string;
  wordCount?: number;
  sourceType?: string;
  biasAnalysis?: BiasAnalysis;
  tables?: { caption: string | null; headers: string[]; rows: string[][]; sourceLabel: string | null }[];
  figures?: { url: string; caption: string | null; altText: string | null; sourceLabel: string | null; mimeType: string }[];
  keyStatistics?: { label: string; value: string; unit: string | null; context: string | null }[];
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

function buildLanguageInstruction(
  lang: string | null | undefined,
  mode: string | null | undefined,
  opts?: { mustIncludeVocabulary?: Array<{ word: string; translation: string }>; forLearning?: boolean },
): { languageInstruction: string; vocabularyInstruction: string; openingLine: string; closingLine: string } {
  if (!lang || (lang === 'en' && !opts?.forLearning)) {
    return {
      languageInstruction: '',
      vocabularyInstruction: '',
      openingLine: '"Good morning — here\'s what you need to know today."',
      closingLine: '"That\'s your briefing for today. See you tomorrow."',
    };
  }

  const langName = LANGUAGE_DISPLAY[lang as keyof typeof LANGUAGE_DISPLAY] ?? lang;

  const modeInstructions: Record<string, string> = {
    vocabulary_intro: `## Language: ${langName} — Vocabulary Introduction Mode

This is a LANGUAGE LEARNING podcast. Speak primarily in English (~90%).
- Introduce 8-12 high-frequency, everyday ${langName} words and phrases naturally in conversation
- Wrap each vocabulary word with [V{N}:word] notation (e.g., [V1:Guten Morgen], [V2:sprechen]). The word inside the marker is the exact target-language text that should be highlighted.
- Use the ANTICIPATION technique: "How would you say 'good morning' in ${langName}?" [pause] "That's right — [V1:Guten Morgen]!"
- Explain meaning, pronunciation guide, and use each word in a short example sentence
- Revisit key words 2-3 times later in the episode for graduated interval recall
- Prioritize functional words: greetings, numbers, common verbs, polite phrases
- Source articles are in English — use them as conversation topics while weaving in ${langName} vocabulary`,

    conversational_mix: `## Language: ${langName} — Conversational Mix Mode

This is a LANGUAGE LEARNING podcast. Mix ${langName} and English (~40% English / ~60% ${langName}).
- Use ${langName} for full sentences and dialogue; English for explanations and transitions
- Wrap 10-15 vocabulary words with [V{N}:word] notation (e.g., [V1:Guten Morgen], [V2:sprechen]). The word inside the marker is the exact target-language text that should be highlighted.
- Use anticipation prompts for new words before revealing them
- Include brief inline translations when introducing new words
- Build on vocabulary from previous episodes (spaced repetition)
- Introduce grammar patterns organically through usage, not explicit rules
- Source articles may be in English — adapt and translate key content into ${langName}`,

    full_immersion: `## Language: ${langName} — Full Immersion Mode

This is a LANGUAGE LEARNING podcast. Generate the ENTIRE script in ${langName} (~95%).
- Wrap 5-8 advanced or nuanced vocabulary items with [V{N}:word] notation (e.g., [V1:Guten Morgen], [V2:sprechen]). The word inside the marker is the exact target-language text that should be highlighted.
- Speak naturally at near-native pace
- Only use English for terms with no direct translation
- Assume the listener knows basics from prior episodes
- Source articles may be in English — translate and adapt ALL content into ${langName}`,
  };

  const instruction = modeInstructions[mode ?? 'conversational_mix'] ?? modeInstructions.conversational_mix;

  const vocabularyInstruction = `## Vocabulary Output — REQUIRED when language learning mode is active

In addition to references, you MUST include a "vocabulary" array in your JSON output:

\`\`\`
"vocabulary": [
  {"number": 1, "word": "sprechen", "translation": "to speak", "partOfSpeech": "verb", "pronunciation": "SHPREE-chen", "exampleSentence": "Ich spreche Deutsch. (I speak German.)", "difficulty": "beginner"},
  ...
]
\`\`\`

Rules:
- Each [V{N}:word] marker in the script MUST have a corresponding vocabulary entry
- "word" is the ${langName} word/phrase
- "translation" is the English translation
- "pronunciation" is a phonetic guide using English approximation (e.g., "SHPREE-chen")
- "partOfSpeech" is noun/verb/adjective/adverb/phrase/expression
- "exampleSentence" shows the word used in a natural sentence with translation in parentheses
- "difficulty" is beginner/intermediate/advanced`;

  const requiredItems = opts?.mustIncludeVocabulary?.length
    ? `\n\n## REQUIRED review items (from the learner's spaced-repetition queue)
You MUST naturally incorporate AND wrap each of these with [V{N}:word], and include each in the vocabulary[] output. Prioritize them as anticipation/recall targets:
${opts.mustIncludeVocabulary.map((v) => `- ${v.word} — ${v.translation}`).join('\n')}`
    : '';

  return {
    languageInstruction: instruction,
    vocabularyInstruction: vocabularyInstruction + requiredItems,
    openingLine: `A culturally appropriate greeting in ${langName} (with English translation if in vocabulary_intro mode)`,
    closingLine: `A culturally appropriate farewell in ${langName} (with English translation if in vocabulary_intro mode)`,
  };
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
  provider: string;
  webSearchEnabled?: boolean;
  mode?: 'standard' | 'demo';
  source?: string;
  previousEpisodesContext?: string;
  targetLanguage?: string | null;
  languageMode?: string | null;
  mustIncludeVocabulary?: Array<{ word: string; translation: string }>;
  forLearning?: boolean;
}): Promise<{
  turns: ScriptTurn[];
  soundCues: SoundCue[];
  references: GeneratedReference[];
  vocabulary: GeneratedVocabularyEntry[];
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
  const briefingMinRefs = Math.max(
    getMinReferenceCount(params.depth || 'standard', params.durationTarget),
    // Briefings should cite most of their input articles
    Math.ceil((params.sourceContent?.match(/^\[\d+\]/gm)?.length ?? 5) * 0.6),
  );
  const langInstr = buildLanguageInstruction(params.targetLanguage, params.languageMode, {
    mustIncludeVocabulary: params.mustIncludeVocabulary,
    forLearning: params.forLearning,
  });
  const systemPrompt = params.source === 'BRIEFING'
    ? loadAndRender('generation/briefing-script.md', {
        VOICE_REALISM: VOICE_REALISM_INSTRUCTIONS,
        CONTENT_SAFETY: CONTENT_SAFETY_INSTRUCTIONS,
        DURATION_TARGET: String(params.durationTarget),
        WORD_COUNT_MIN: String(wordCountBounds(params.durationTarget).min),
        WORD_COUNT_MAX: String(wordCountBounds(params.durationTarget).max),
        WORD_COUNT_IDEAL: String(minutesToWords(params.durationTarget)),
        SPEAKER_SECTION: speakerSection,
        HOST_SPEAKER: speakers[0].name,
        EXPERT_SPEAKER: speakers.length > 1 ? speakers[1].name : speakers[0].name,
        SOURCE_ARTICLES: params.sourceContent || '',
        PREVIOUS_EPISODES: params.previousEpisodesContext || '',
        MIN_REFERENCE_COUNT: String(briefingMinRefs),
        LANGUAGE_INSTRUCTION: langInstr.languageInstruction,
        VOCABULARY_INSTRUCTION: langInstr.vocabularyInstruction,
        OPENING_LINE: langInstr.openingLine,
        CLOSING_LINE: langInstr.closingLine,
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
        DEPTH: params.depth,
        MIN_REFERENCE_COUNT: String(getMinReferenceCount(params.depth, params.durationTarget)),
        MIN_SERIOUS_PERCENT: String(Math.round(getMinSeriousRatio(params.depth, params.tone) * 100)),
        SERIOUS_RATIO_NOTE: ['comedic', 'satirical', 'storytelling'].includes(params.tone)
          ? ' (Relaxed for this tone — prefer ARTICLE sources from established news outlets over academic papers.)'
          : '',
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

  const result = parseScriptResponse(response);

  // For BRIEFING source: map references back to real source article URLs.
  // The LLM may hallucinate URLs despite being told to use source articles.
  // This deterministic post-processing replaces any reference URLs with the
  // real URLs extracted from the formatted source articles.
  if (params.source === 'BRIEFING' && params.sourceContent) {
    result.references = mapBriefingReferences(result.references, params.sourceContent);
  }

  return result;
}

/**
 * Parse formatted source articles (from formatArticlesForPrompt) to extract
 * article number → { title, url } mapping, then replace LLM-generated reference
 * URLs with the real ones by matching on reference number or title similarity.
 */
function mapBriefingReferences(
  refs: GeneratedReference[],
  sourceContent: string,
): GeneratedReference[] {
  // Parse source articles: [N] Source — "Title" (date)\n    URL: https://...\n    Summary
  const articleMap = new Map<number, { title: string; url: string; source: string }>();
  const articleRegex = /\[(\d+)\]\s+(.+?)\s*—\s*"(.+?)"\s*\(.+?\)\n\s+URL:\s*(\S+)/g;
  let match;
  while ((match = articleRegex.exec(sourceContent)) !== null) {
    articleMap.set(parseInt(match[1], 10), {
      source: match[2].trim(),
      title: match[3].trim(),
      url: match[4].trim(),
    });
  }

  if (articleMap.size === 0) return refs;

  return refs.map((ref) => {
    // First: try exact number match
    const byNumber = articleMap.get(ref.number);
    if (byNumber) {
      return { ...ref, url: byNumber.url, title: ref.title || byNumber.title, type: 'ARTICLE' as const };
    }

    // Second: fuzzy title match (LLM may reorder numbers)
    const refTitleLower = (ref.title || '').toLowerCase();
    for (const [, article] of articleMap) {
      if (refTitleLower && article.title.toLowerCase().includes(refTitleLower.slice(0, 30))) {
        return { ...ref, url: article.url, type: 'ARTICLE' as const };
      }
      if (refTitleLower && refTitleLower.includes(article.title.toLowerCase().slice(0, 30))) {
        return { ...ref, url: article.url, type: 'ARTICLE' as const };
      }
    }

    // No match — keep the reference but mark URL as null so verification catches it
    // rather than using a hallucinated URL
    return { ...ref, url: null };
  });
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
  groundedReferenceHints?: Array<{
    refNumber: number;
    originalTitle: string;
    originalUrl: string | null;
    found: boolean;
    replacement?: {
      title: string;
      authors: string[];
      year: number | null;
      url: string | null;
      doi: string | null;
      publisher: string | null;
    };
    claimText: string;
    reasoning: string;
  }>;
  /** Escalating repair strategy: replace sources → rewrite claims → drop unverifiable */
  repairMode?: 'replace_sources' | 'rewrite_to_sources' | 'drop_unverifiable';
  /** Reference numbers that must NOT be reused (flagged as unreliable) */
  bannedRefNumbers?: number[];
  apiKeyOverride?: string;
  model?: string;
  provider: string;
  webSearchEnabled?: boolean;
  targetLanguage?: string | null;
  languageMode?: string | null;
}): Promise<{
  turns: ScriptTurn[];
  soundCues: SoundCue[];
  references: GeneratedReference[];
  vocabulary: GeneratedVocabularyEntry[];
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

  const useSearch = params.webSearchEnabled !== false;
  const webSearchGuidance = useSearch
    ? '## Web Search:\nYou have access to web search. Use it to verify facts, find accurate statistics, and discover current information to improve the script.'
    : '## Web Search:\nYou do NOT have web search in this revision pass. Work with the references and source material already provided. If a claim cannot be verified from the available references, soften the language or remove the claim. Ignore any instructions above that reference "web search."';

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
    WEB_SEARCH_GUIDANCE: webSearchGuidance,
    DEPTH: params.depth,
    MIN_REFERENCE_COUNT: String(getMinReferenceCount(params.depth, params.durationTarget)),
    MIN_SERIOUS_PERCENT: String(Math.round(getMinSeriousRatio(params.depth, params.tone) * 100)),
    SERIOUS_RATIO_NOTE: ['comedic', 'satirical', 'storytelling'].includes(params.tone)
      ? ' (Relaxed for this tone — prefer ARTICLE sources from established news outlets over academic papers.)'
      : '',
  });

  const previousScriptText = params.previousScript
    .map((t, i) => `[${i}] ${t.speaker}: ${t.text}`)
    .join('\n');

  // Split references into allowed and banned
  const bannedSet = new Set(params.bannedRefNumbers ?? []);
  const allowedRefs = params.previousReferences.filter((r) => !bannedSet.has(r.number));
  const bannedRefs = params.previousReferences.filter((r) => bannedSet.has(r.number));

  const allowedRefsText = allowedRefs.length > 0
    ? allowedRefs.map((r) => `[${r.number}] "${r.title}" (${r.type}) — ${r.url || 'no url'}`).join('\n')
    : '(none — all previous references were flagged as unreliable)';

  let bannedRefsSection = '';
  if (bannedRefs.length > 0) {
    const bannedLines = bannedRefs.map((r) => `[${r.number}] "${r.title}" — ${r.url || 'no url'}`).join('\n');
    bannedRefsSection = `\n## BANNED REFERENCES (DO NOT REUSE — these are unreliable sources):\n${bannedLines}\n`;
  }

  // Build grounded replacements section if available
  let groundedSection = '';
  if (params.groundedReferenceHints && params.groundedReferenceHints.length > 0) {
    const lines = params.groundedReferenceHints.map((h) => {
      if (h.found && h.replacement) {
        const authors = h.replacement.authors.length > 0 ? ` by ${h.replacement.authors.join(', ')}` : '';
        const year = h.replacement.year ? ` (${h.replacement.year})` : '';
        const doi = h.replacement.doi ? `\n    DOI: ${h.replacement.doi}` : '';
        return `[${h.refNumber}] VERIFIED REPLACEMENT — use this source instead:
    "${h.replacement.title}"${authors}${year}
    URL: ${h.replacement.url || 'none'}${doi}
    Claim it supports: "${h.claimText}"
    Reasoning: ${h.reasoning}`;
      }
      return `[${h.refNumber}] NO REPLACEMENT FOUND — we searched and could not verify this claim. Remove it entirely or soften to hedged language ("some researchers suggest...").
    Original: "${h.originalTitle}"
    Claim: "${h.claimText}"`;
    });
    groundedSection = `\n## GROUNDED REPLACEMENTS (we searched the web for you — use these real sources):\n${lines.join('\n\n')}\n`;
  }

  // Repair mode instructions — escalate with each attempt
  const REPAIR_INSTRUCTIONS: Record<string, string> = {
    replace_sources: `## REPAIR MODE: REPLACE SOURCES
For each flagged claim, use the grounded replacement source if one was found.
If no replacement was found, use web search to find a reputable source (news outlets, official reports, academic papers).
Do NOT cite blogs, Reddit, aggregators, or social media.`,
    rewrite_to_sources: `## REPAIR MODE: REWRITE CLAIMS TO MATCH SOURCES
Previous attempts to find replacement sources for some claims failed.
For claims where no verifiable source exists: REWRITE the claim to state a different, related fact that CAN be verified from a reputable source.
It is better to make a slightly different but well-sourced claim than to keep an unverifiable one.
Drop claims entirely if you cannot find ANY verifiable angle.`,
    drop_unverifiable: `## REPAIR MODE: SURGICAL FIX — PRESERVE GOOD TURNS, FIX ONLY BAD ONES
This is the final attempt. The previous script was ALMOST passing — most turns are already good.
CRITICAL RULES:
1. Keep ALL turns that are NOT mentioned in the feedback EXACTLY as they are — same wording, same citations, same references.
2. For turns mentioned in the feedback: ONLY fix the specific issue flagged (unsupported claim or unreliable source).
3. To fix an unsupported claim: either add a real citation from web search, or REMOVE just that sentence and adjust the turn for flow.
4. To fix an unreliable source: replace it with a reputable one from web search, or remove the claim.
5. Do NOT rewrite turns that passed verification. Do NOT introduce new claims. Do NOT change references that were not flagged.
6. It is better to have a slightly shorter script with all claims verified than to add new unverified content.`,
  };

  const repairSection = params.repairMode ? `\n${REPAIR_INSTRUCTIONS[params.repairMode]}\n` : '';

  const revisionLangInstr = buildLanguageInstruction(params.targetLanguage, params.languageMode);
  const languageSection = revisionLangInstr.languageInstruction
    ? `\n${revisionLangInstr.languageInstruction}\n\n${revisionLangInstr.vocabularyInstruction}\n`
    : '';

  const userMessage = `Topic: ${params.topic}
Depth: ${params.depth}

## FACT-CHECKER FEEDBACK:
${params.verificationFeedback}
${repairSection}${groundedSection}${bannedRefsSection}${languageSection}
## PREVIOUS SCRIPT (to revise):
${previousScriptText}

## ALLOWED REFERENCES (you may keep these):
${allowedRefsText}

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
  provider: string;
  webSearchEnabled?: boolean;
}): Promise<{
  turns: ScriptTurn[];
  soundCues: SoundCue[];
  references: GeneratedReference[];
  vocabulary: GeneratedVocabularyEntry[];
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
export function parseScriptResponse(response: {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}): {
  turns: ScriptTurn[];
  soundCues: SoundCue[];
  references: GeneratedReference[];
  vocabulary: GeneratedVocabularyEntry[];
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

  const vocabulary = ((validated.vocabulary ?? []) as Array<Record<string, unknown>>).map((v) => ({
    number: v.number as number,
    word: v.word as string,
    translation: v.translation as string,
    partOfSpeech: (v.partOfSpeech as string) ?? null,
    pronunciation: (v.pronunciation as string) ?? null,
    exampleSentence: (v.exampleSentence as string) ?? null,
    difficulty: (v.difficulty as string) ?? null,
  }));

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
    vocabulary,
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
  const sections: string[] = [];

  if (metadata && (metadata.title || metadata.author || metadata.publishedDate || metadata.siteName)) {
    const parts = [
      metadata.title && `Title: ${metadata.title}`,
      metadata.author && `Author: ${metadata.author}`,
      metadata.publishedDate && `Published: ${metadata.publishedDate}`,
      metadata.siteName && `Source: ${metadata.siteName}`,
    ].filter(Boolean);
    sections.push(`Source material:\n${parts.join(' | ')}\nContent:\n${truncated}`);
  } else {
    sections.push(`Source material:\n${truncated}`);
  }

  // Append structured data so the AI gets exact values
  if (metadata?.tables && metadata.tables.length > 0) {
    const tableBlocks = metadata.tables.map((t, i) => {
      const label = t.caption || `Table ${i + 1}`;
      const header = t.headers.join(' | ');
      const rows = t.rows.slice(0, 20).map((r) => r.join(' | ')).join('\n');
      return `[${label}]\n${header}\n${rows}`;
    });
    sections.push(`\nSource Tables:\n${tableBlocks.join('\n\n')}`);
  }

  if (metadata?.figures && metadata.figures.length > 0) {
    const figureLines = metadata.figures.map((f, i) => {
      const label = f.caption || f.altText || `Figure ${i + 1}`;
      return `[Figure ${i + 1}: "${label}"]`;
    });
    sections.push(`\nSource Figures:\n${figureLines.join('\n')}`);
  }

  if (metadata?.keyStatistics && metadata.keyStatistics.length > 0) {
    const statLines = metadata.keyStatistics.map((s) => {
      const unit = s.unit ? ` ${s.unit}` : '';
      const ctx = s.context ? ` (${s.context})` : '';
      return `- ${s.label}: ${s.value}${unit}${ctx}`;
    });
    sections.push(`\nKey Statistics:\n${statLines.join('\n')}`);
  }

  return sections.join('\n');
}
