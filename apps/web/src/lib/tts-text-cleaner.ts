/**
 * Audience reaction tags that should be stripped from TTS input and
 * converted to SFX inserts at render time. Scoped carefully to NOT
 * match speaker-level tags like [laughs], [chuckles], [sighs].
 */
export const AUDIENCE_REACTION_PATTERN = /\[(?:audience laughs?|audience laughter|crowd laughter|applause|audience applause|crowd cheers)\]/gi;

/**
 * Parenthetical stage directions that should be stripped from TTS input
 * and teleprompter display. These are NOT valid inline audio tags — the
 * correct format is [pause], [laughs], etc. When the LLM writes (pause)
 * in parentheses, TTS speaks it literally.
 */
export const STAGE_DIRECTION_PATTERN = /\((?:(?:long |short |dramatic )?pause|laughs?|chuckles?|giggles?|sighs?|gasps?|whispers?|excited|sarcastic|curious|nervously|cautiously|beat|silence)\)/gi;

export type AudienceReactionType = 'laugh_track' | 'applause';

export interface AudienceReaction {
  type: AudienceReactionType;
  offsetChars: number; // character offset in the original text
}

/**
 * Extract audience reaction tags and their positions from turn text.
 * Used by the stitching worker to inject SFX at correct timestamps.
 */
export function extractAudienceReactions(text: string): AudienceReaction[] {
  const reactions: AudienceReaction[] = [];
  const re = /\[(audience laughs?|audience laughter|crowd laughter|applause|audience applause|crowd cheers)\]/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    const tag = match[1].toLowerCase();
    const type: AudienceReactionType = tag.includes('applause') || tag.includes('cheers') ? 'applause' : 'laugh_track';
    reactions.push({ type, offsetChars: match.index });
  }
  return reactions;
}

/**
 * TTS text safety net — strips non-speech markers before sending to TTS.
 * Provider-specific tag conversion is handled upstream by tts-tag-converter.ts.
 */
export function cleanTextForTts(text: string): string {
  return text
    .replace(/\[SFX:.*?\]/gi, '')
    .replace(AUDIENCE_REACTION_PATTERN, '')
    .replace(STAGE_DIRECTION_PATTERN, '')
    .replace(/\s*\[\d+(?:,\s*\d+)*\]/g, '')
    .replace(/\s*\[V\d+\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Split text into chunks that fit within a provider's character limit.
 *
 * Uses 80% of maxChars as the target to leave headroom for provider-specific
 * additions (e.g. ElevenLabs audio tag injection at sentence boundaries).
 *
 * Split priority: sentence boundary (.!?) > comma/semicolon > word boundary.
 */
export function splitTextForTts(text: string, maxChars: number): string[] {
  const target = Math.floor(maxChars * 0.8);
  if (text.length <= target) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > target) {
    const window = remaining.slice(0, maxChars);

    // Try sentence boundary (. ! ? followed by space) — search backwards from target
    let splitIdx = -1;
    for (let i = target; i > target * 0.3; i--) {
      if (/[.!?]/.test(window[i - 1]) && window[i] === ' ') {
        splitIdx = i;
        break;
      }
    }

    // Fallback: comma or semicolon boundary
    if (splitIdx === -1) {
      for (let i = target; i > target * 0.3; i--) {
        if (/[,;]/.test(window[i - 1]) && window[i] === ' ') {
          splitIdx = i;
          break;
        }
      }
    }

    // Fallback: any word boundary
    if (splitIdx === -1) {
      splitIdx = window.lastIndexOf(' ', target);
    }

    // Last resort: hard cut at target
    if (splitIdx <= 0) {
      splitIdx = target;
    }

    chunks.push(remaining.slice(0, splitIdx).trim());
    remaining = remaining.slice(splitIdx).trim();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}
