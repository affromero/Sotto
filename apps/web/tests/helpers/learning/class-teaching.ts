import type { ClassTeaching } from '@sotto/shared';

export const sampleTeaching: ClassTeaching = {
  version: 1,
  title: 'Hablar de ayer',
  explanation:
    'Para contar una actividad terminada, relaciona el verbo con la persona y el momento. Compara los ejemplos antes de elegir una forma.',
  workedExamples: [
    {
      prompt: 'Ana visitó un museo ayer. Cuenta su actividad.',
      answer: 'Ana visitó el museo ayer.',
      explanation: 'La forma visitó cuenta una actividad terminada de Ana.',
    },
    {
      prompt: 'Tú terminaste un libro. Cuenta tu actividad.',
      answer: 'Terminé el libro ayer.',
      explanation: 'Terminé expresa la primera persona y una actividad terminada.',
    },
  ],
  commonMistake: {
    incorrect: 'Yo visitó el museo.',
    correction: 'Yo visité el museo.',
    explanation: 'Con yo, la forma es visité; visitó corresponde a otra persona.',
  },
  guidedPractice: {
    prompt: 'Cuenta que Ana terminó un libro ayer.',
    hint: 'Relaciona la forma con Ana.',
    answer: 'Ana terminó un libro ayer.',
    explanation: 'Terminó corresponde a Ana y sitúa la actividad en el pasado.',
  },
};
