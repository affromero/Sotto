import { z } from 'zod';

export const vocabularySupportSchema = z.enum([
  'MEANING_RECALL',
  'WORD_RECALL',
  'LISTENING_RECOGNITION',
]);
export type VocabularySupport = z.infer<typeof vocabularySupportSchema>;

export const VOCABULARY_SUPPORT_OPTIONS: ReadonlyArray<{
  value: VocabularySupport;
  label: string;
  guidance: string;
}> = [
  {
    value: 'MEANING_RECALL',
    label: 'I forget what a word means, even when I see it.',
    guidance:
      'Explain word meanings explicitly with short native-language glosses and concrete examples. Use meaningful semantic contrasts in contextual exercises. After an answer, explain the intended meaning and offer a memorable association when useful. Revisit meanings across spaced practice.',
  },
  {
    value: 'WORD_RECALL',
    label: 'I recognize words, but cannot find them when speaking or writing.',
    guidance:
      'Support retrieval of target-language words from meanings and situations. Use contextual gaps and short supported speaking or writing tasks, then gradually reduce cues. Reuse useful phrases in new sentences and explain the correct word after an answer.',
  },
  {
    value: 'LISTENING_RECOGNITION',
    label: 'I know words in writing, but miss them when listening.',
    guidance:
      'Connect written word forms to their sounds in listening activities that are already enabled. Use short phrases, clear pronunciation and transcript support before reducing cues. Preserve the configured skill and audio requirements; this preference does not enable or require speech.',
  },
];

export function vocabularySupportGuidance(support: VocabularySupport | null): string {
  const option = VOCABULARY_SUPPORT_OPTIONS.find((item) => item.value === support);
  if (!option) return '';
  return `Vocabulary support requested by the learner: ${option.guidance} Treat this self-report as a starting preference. Assessment results determine mastery; this choice does not establish ability or change answer keys.`;
}
