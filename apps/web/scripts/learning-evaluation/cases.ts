import { z } from 'zod';

export const lessonSchema = z
  .object({
    level: z.literal('A1'),
    text: z.string().min(1),
    question: z.string().min(1),
    answer: z.string().min(1),
  })
  .strict();
export const gradeSchema = z
  .object({
    correct: z.boolean(),
    correction: z.string(),
    explanation: z.string().min(1),
  })
  .strict();

export interface EvaluationCase {
  id: string;
  prompt: string;
  schema: z.ZodType;
  fixture: unknown;
  check: (value: unknown) => string[];
}

/** Synthetic material only. These checks are reproducible proxies, not a CEFR certification. */
export const evaluationCases: readonly EvaluationCase[] = [
  {
    id: 'a1-spanish-listening',
    prompt:
      'Write an A1 Spanish listening passage of 25 to 60 words about Ana buying bread and milk. Use pan and leche. Add one Spanish comprehension question and its answer, supported directly by the passage. Return level, text, question and answer.',
    schema: lessonSchema,
    fixture: {
      level: 'A1',
      text: 'Ana vive cerca de una tienda. Hoy va a la tienda por la mañana. Compra pan y leche para su familia. Después vuelve a casa y prepara el desayuno.',
      question: '¿Qué compra Ana?',
      answer: 'pan y leche',
    },
    check(value) {
      const lesson = lessonSchema.parse(value);
      const words = lesson.text.trim().split(/\s+/).length;
      return [
        ...(words < 25 || words > 60 ? ['passage-word-budget'] : []),
        ...(!/\bpan\b/iu.test(lesson.text) || !/\bleche\b/iu.test(lesson.text)
          ? ['target-vocabulary']
          : []),
        ...(!lesson.text.toLocaleLowerCase('es').includes(lesson.answer.toLocaleLowerCase('es'))
          ? ['literal-answer-support']
          : []),
      ];
    },
  },
  {
    id: 'spanish-agreement-error',
    prompt:
      'Grade this A1 Spanish sentence for subject-verb agreement: "Yo tiene un perro." Return correct (boolean), correction (the corrected full sentence), and a short explanation in English.',
    schema: gradeSchema,
    fixture: {
      correct: false,
      correction: 'Yo tengo un perro.',
      explanation: 'Use tengo with yo.',
    },
    check(value) {
      const grade = gradeSchema.parse(value);
      return [
        ...(grade.correct ? ['missed-agreement-error'] : []),
        ...(grade.correction.trim().replace(/[.!]$/, '').toLowerCase() !== 'yo tengo un perro'
          ? ['incorrect-correction']
          : []),
      ];
    },
  },
  {
    id: 'spanish-correct-answer',
    prompt:
      'Grade this A1 Spanish sentence for subject-verb agreement: "Yo tengo un perro." Return correct (boolean), correction (empty if correct), and a short explanation in English.',
    schema: gradeSchema,
    fixture: { correct: true, correction: '', explanation: 'Tengo agrees with yo.' },
    check(value) {
      const grade = gradeSchema.parse(value);
      return !grade.correct || grade.correction !== '' ? ['overcorrected-valid-answer'] : [];
    },
  },
];
