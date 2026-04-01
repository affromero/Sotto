/**
 * Forced alignment fallback — use STT transcription to recover word-level
 * timestamps when the TTS provider doesn't support them natively.
 *
 * Best-effort: returns null on any error, never throws.
 */
import { createSttProvider, resolveSttProvider } from '@/lib/providers/stt';
import type { WordTiming } from '@sotto/shared';

export async function getWordTimingsViaStt(
  audioBuffer: Buffer,
  text: string,
  userId: string,
): Promise<WordTiming[] | null> {
  try {
    const resolved = await resolveSttProvider({ userId });
    const provider = createSttProvider(resolved.providerId, resolved.apiKey, resolved.model);
    const result = await provider.transcribe(audioBuffer);

    if (!result.words || result.words.length === 0) return null;

    // Word-matching: align STT output against original text
    const originalWords = text.replace(/[^\w\s]/g, '').toLowerCase().split(/\s+/).filter(Boolean);
    const sttWords = result.words;

    if (sttWords.length === 0) return null;

    // Simple sequential matching with tolerance
    const matched: WordTiming[] = [];
    let sttIdx = 0;

    for (const origWord of originalWords) {
      if (sttIdx >= sttWords.length) break;
      const sttWord = sttWords[sttIdx].word.toLowerCase().replace(/[^\w]/g, '');

      // Exact match or close enough (prefix match for longer words)
      if (sttWord === origWord || (origWord.length > 3 && sttWord.startsWith(origWord.substring(0, 3)))) {
        matched.push({
          word: sttWords[sttIdx].word,
          start: sttWords[sttIdx].start,
          end: sttWords[sttIdx].end,
        });
        sttIdx++;
      } else {
        // Try skipping STT word (insertion by STT)
        if (sttIdx + 1 < sttWords.length) {
          const nextStt = sttWords[sttIdx + 1].word.toLowerCase().replace(/[^\w]/g, '');
          if (nextStt === origWord) {
            sttIdx++;
            matched.push({
              word: sttWords[sttIdx].word,
              start: sttWords[sttIdx].start,
              end: sttWords[sttIdx].end,
            });
            sttIdx++;
            continue;
          }
        }
        // Interpolate timing for unmatched word
        if (matched.length > 0 && sttIdx < sttWords.length) {
          const prevEnd = matched[matched.length - 1].end;
          const nextStart = sttWords[sttIdx].start;
          matched.push({ word: origWord, start: prevEnd, end: nextStart });
        }
      }
    }

    // If match rate is too low, discard
    if (matched.length < originalWords.length * 0.6) return null;

    return matched;
  } catch {
    return null;
  }
}
