import { cefrRank } from '../cefr-levels';
import type { CefrLevel } from '@sotto/shared';

export function isImmersionLevel(level: string): boolean {
  return cefrRank(level as CefrLevel) >= cefrRank('A2');
}

export function classIntroExampleMeaningPolicy(p: {
  level: string;
  nativeLang: string;
  targetLang: string;
}): string {
  return [
    isImmersionLevel(p.level)
      ? `For each intro example, write its meaning as a short, grammatical ${p.targetLang} usage note at the learner's ${p.level} level. Explain what the example communicates or how it is used. It may reuse the target's words; do not force synonyms or lexical differences.`
      : `For each intro example, preserve the exact meaning of the target sentence. Concise ${p.nativeLang} support is allowed under the A1 language policy.`,
    'Preserve who speaks and acts, participant identities and count, group membership, referents, tense, negation and modality. Prefer neutral explanatory wording when addressing the learner could change those relationships. A first-person group does not establish that the learner or addressee belongs to it.',
    'An explanation may use a different grammatical subject, person or number when it refers to the same participants and action. Agreement follows the explanation’s own grammatical subject in the target language. A singular collective noun can refer to the same plural group; do not require the original sentence’s plural verb form with that singular subject. Reject any added or excluded participant or changed action.',
    'Do not require identical pronouns or wording. Any change in participant identity or group membership must be explicitly supported by the trusted lesson context. Do not infer participants, events, results, intentions or grammar claims from the generated explanation itself.',
    'A meaning must express the actual action and relationships in the example. A broader statement that omits the action is not an equivalent explanation. Keep every claim grammatical, natural and supported by the example and trusted lesson context.',
  ].join(' ');
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
      'If an output schema has a field named "translation" or "meaning", fill it with a target-language paraphrase or usage note, not a native-language translation.',
      'Native-language support is handled by selection/right-click tools outside this generated class content.',
    ].join(' ');
  }

  return [
    `A1 scaffolding: keep the target language (${p.targetLang}) dominant, but concise native-language (${p.nativeLang}) support is allowed when it prevents confusion.`,
    'Examples and answer options should still exercise the target language.',
  ].join(' ');
}
