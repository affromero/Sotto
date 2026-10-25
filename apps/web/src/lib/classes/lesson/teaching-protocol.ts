import type { ClassTeaching } from '@sotto/shared';
import { countWords } from '../../duration';

export const MAX_TEACHING_WORDS = 600;

/** Measure every learner-visible field without constraining individual sentences. */
export function teachingWordCounts(unit: ClassTeaching) {
  const measure = (field: string, text: string) => ({
    field,
    actualWords: countWords(text),
  });
  return [
    measure('title', unit.title),
    measure('explanation', unit.explanation),
    ...unit.workedExamples.flatMap((item, index) =>
      (['prompt', 'answer', 'explanation'] as const).map((field) =>
        measure(`workedExamples[${index}].${field}`, item[field])
      )
    ),
    ...(['incorrect', 'correction', 'explanation'] as const).map((field) =>
      measure(`commonMistake.${field}`, unit.commonMistake[field])
    ),
    ...(['prompt', 'hint', 'answer', 'explanation'] as const).map((field) =>
      measure(`guidedPractice.${field}`, unit.guidedPractice[field])
    ),
  ];
}
