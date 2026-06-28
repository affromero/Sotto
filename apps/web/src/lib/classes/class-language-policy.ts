import { cefrRank } from '../cefr-levels';
import type { CefrLevel } from '@sotto/shared';

export function isImmersionLevel(level: string): boolean {
  return cefrRank(level as CefrLevel) >= cefrRank('A2');
}

export function classLanguagePolicy(p: {
  level: string;
  nativeLang: string;
  targetLang: string;
}): string {
  if (isImmersionLevel(p.level)) {
    return [
      `Immediate immersion for ${p.level}: every learner-visible field must be in the target language (${p.targetLang}).`,
      `Do not write native-language (${p.nativeLang}) explanations, hints, translations, option text, guidance, or feedback.`,
      'If an output schema has a legacy field named "translation" or "meaning", fill it with a target-language paraphrase or usage note, not a native-language translation.',
      'Native-language support is handled by selection/right-click tools outside this generated class content.',
    ].join(' ');
  }

  return [
    `A1 scaffolding: keep the target language (${p.targetLang}) dominant, but concise native-language (${p.nativeLang}) support is allowed when it prevents confusion.`,
    'Examples and answer options should still exercise the target language.',
  ].join(' ');
}
