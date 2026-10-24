import { z } from 'zod';
import { classTeachingSchema, type ClassTeaching } from '@sotto/shared';
import { countWords } from '../../duration';

export const MAX_TEACHING_WORDS = 600;
export const teachingWordLimits = {
  title: 10,
  explanation: 170,
  workedExample: { prompt: 25, answer: 35, explanation: 25 },
  commonMistake: { incorrect: 15, correction: 15, explanation: 25 },
  guidedPractice: { prompt: 30, hint: 15, answer: 35, explanation: 25 },
} as const;

function boundedWords(text: z.ZodString, maximum: number) {
  return text.regex(new RegExp(`^\\S+(?:\\s+\\S+){0,${maximum - 1}}$`, 'u'));
}

const shape = classTeachingSchema.shape;
const example = shape.workedExamples.element.shape;
const mistake = shape.commonMistake.shape;
const guided = shape.guidedPractice.shape;

/** All three examples at every field maximum total 595 words. Saved units retain their schema. */
export const classTeachingAuthoringSchema = classTeachingSchema.extend({
  title: boundedWords(shape.title, teachingWordLimits.title),
  explanation: boundedWords(shape.explanation, teachingWordLimits.explanation),
  workedExamples: z
    .array(
      shape.workedExamples.element.extend({
        prompt: boundedWords(example.prompt, teachingWordLimits.workedExample.prompt),
        answer: boundedWords(example.answer, teachingWordLimits.workedExample.answer),
        explanation: boundedWords(
          example.explanation,
          teachingWordLimits.workedExample.explanation
        ),
      })
    )
    .min(2)
    .max(3),
  commonMistake: shape.commonMistake.extend({
    incorrect: boundedWords(mistake.incorrect, teachingWordLimits.commonMistake.incorrect),
    correction: boundedWords(mistake.correction, teachingWordLimits.commonMistake.correction),
    explanation: boundedWords(mistake.explanation, teachingWordLimits.commonMistake.explanation),
  }),
  guidedPractice: shape.guidedPractice.extend({
    prompt: boundedWords(guided.prompt, teachingWordLimits.guidedPractice.prompt),
    hint: boundedWords(guided.hint, teachingWordLimits.guidedPractice.hint),
    answer: boundedWords(guided.answer, teachingWordLimits.guidedPractice.answer),
    explanation: boundedWords(guided.explanation, teachingWordLimits.guidedPractice.explanation),
  }),
});

/** Use the canonical counter for every field, including the complete repair diagnostics. */
export function teachingWordCounts(unit: ClassTeaching) {
  const measure = (field: string, text: string, maxWords: number) => ({
    field,
    actualWords: countWords(text),
    maxWords,
  });
  return [
    measure('title', unit.title, teachingWordLimits.title),
    measure('explanation', unit.explanation, teachingWordLimits.explanation),
    ...unit.workedExamples.flatMap((item, index) =>
      (['prompt', 'answer', 'explanation'] as const).map((field) =>
        measure(
          `workedExamples[${index}].${field}`,
          item[field],
          teachingWordLimits.workedExample[field]
        )
      )
    ),
    ...(['incorrect', 'correction', 'explanation'] as const).map((field) =>
      measure(
        `commonMistake.${field}`,
        unit.commonMistake[field],
        teachingWordLimits.commonMistake[field]
      )
    ),
    ...(['prompt', 'hint', 'answer', 'explanation'] as const).map((field) =>
      measure(
        `guidedPractice.${field}`,
        unit.guidedPractice[field],
        teachingWordLimits.guidedPractice[field]
      )
    ),
  ];
}
