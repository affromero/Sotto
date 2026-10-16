import type { ClassTeaching } from '@sotto/shared';

export const teaching: ClassTeaching = {
  version: 1,
  title: 'Describe a finished visit',
  explanation:
    'Use the Perfekt to describe a completed visit. The auxiliary agrees with the subject; the participle goes at the end.',
  workedExamples: [
    {
      prompt: 'Tell a friend about your visit.',
      answer: 'Ich habe gestern Anna besucht.',
      explanation: 'Besuchen uses haben. Besucht goes at the end.',
    },
    {
      prompt: 'Describe your journey home.',
      answer: 'Ich bin nach Hause gegangen.',
      explanation: 'Gehen uses sein for this journey.',
    },
  ],
  commonMistake: {
    incorrect: 'Ich habe nach Hause gegangen.',
    correction: 'Ich bin nach Hause gegangen.',
    explanation: 'Use sein with gehen in this sentence.',
  },
  guidedPractice: {
    prompt: 'Say that you visited Ben yesterday.',
    hint: 'Start with Ich habe and put besucht last.',
    answer: 'Ich habe gestern Ben besucht.',
    explanation: 'The auxiliary and participle frame the rest of the sentence.',
  },
};
