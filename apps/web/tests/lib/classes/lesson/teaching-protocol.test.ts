import { describe, expect, it } from 'vitest';
import { teachingWordCounts } from '@/lib/classes/lesson/teaching-protocol';
import { sampleTeaching } from '../../../helpers/learning/class-teaching';

describe('teaching reading measurements', () => {
  it('counts paragraph breaks and whitespace without changing the complete text', () => {
    const unit = {
      ...sampleTeaching,
      explanation: 'Primera frase.\n\nSegunda\tfrase con\u00a0énfasis.',
      workedExamples: [
        ...sampleTeaching.workedExamples,
        { prompt: 'Otra situación.', answer: 'Una respuesta completa.', explanation: 'Por eso.' },
      ],
    };
    const before = structuredClone(unit);
    expect(teachingWordCounts(unit)).toEqual([
      { field: 'title', actualWords: 3 },
      { field: 'explanation', actualWords: 6 },
      { field: 'workedExamples[0].prompt', actualWords: 8 },
      { field: 'workedExamples[0].answer', actualWords: 5 },
      { field: 'workedExamples[0].explanation', actualWords: 9 },
      { field: 'workedExamples[1].prompt', actualWords: 7 },
      { field: 'workedExamples[1].answer', actualWords: 4 },
      { field: 'workedExamples[1].explanation', actualWords: 9 },
      { field: 'workedExamples[2].prompt', actualWords: 2 },
      { field: 'workedExamples[2].answer', actualWords: 3 },
      { field: 'workedExamples[2].explanation', actualWords: 2 },
      { field: 'commonMistake.incorrect', actualWords: 4 },
      { field: 'commonMistake.correction', actualWords: 4 },
      { field: 'commonMistake.explanation', actualWords: 11 },
      { field: 'guidedPractice.prompt', actualWords: 7 },
      { field: 'guidedPractice.hint', actualWords: 5 },
      { field: 'guidedPractice.answer', actualWords: 5 },
      { field: 'guidedPractice.explanation', actualWords: 11 },
    ]);
    expect(unit).toEqual(before);
  });
});
