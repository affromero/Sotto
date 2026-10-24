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

const wireWord = z.string().regex(/^[^\s\x00-\x1f\x7f-\x9f]+(?:\n\n)?$/u);
const decodedWord = wireWord.refine((value) => {
  const word = value.endsWith('\n\n') ? value.slice(0, -2) : value;
  return word.length > 0 && !/\s/u.test(word);
});

function draftSchema(bounded: boolean) {
  const words = (maximum: number) => {
    const list = z.array(bounded ? wireWord : decodedWord).min(1);
    return bounded ? list.max(maximum) : list;
  };
  return z
    .object({
      version: z.literal(1),
      title: words(teachingWordLimits.title),
      explanation: words(teachingWordLimits.explanation),
      workedExamples: z
        .array(
          z
            .object({
              prompt: words(teachingWordLimits.workedExample.prompt),
              answer: words(teachingWordLimits.workedExample.answer),
              explanation: words(teachingWordLimits.workedExample.explanation),
            })
            .strict()
        )
        .min(2)
        .max(3),
      commonMistake: z
        .object({
          incorrect: words(teachingWordLimits.commonMistake.incorrect),
          correction: words(teachingWordLimits.commonMistake.correction),
          explanation: words(teachingWordLimits.commonMistake.explanation),
        })
        .strict(),
      guidedPractice: z
        .object({
          prompt: words(teachingWordLimits.guidedPractice.prompt),
          hint: words(teachingWordLimits.guidedPractice.hint),
          answer: words(teachingWordLimits.guidedPractice.answer),
          explanation: words(teachingWordLimits.guidedPractice.explanation),
        })
        .strict(),
    })
    .strict();
}

/** Private word slots avoid intersecting long counted patterns with character limits. */
export const classTeachingProviderSchema = draftSchema(true);

function joinWords(words: string[]) {
  return words.join(' ').replaceAll('\n\n ', '\n\n');
}

/** Decode before local budgets so ignored provider limits retain exact field diagnostics. */
export const classTeachingDraftSchema = draftSchema(false).transform((draft) => ({
  version: draft.version,
  title: joinWords(draft.title),
  explanation: joinWords(draft.explanation),
  workedExamples: draft.workedExamples.map((example) => ({
    prompt: joinWords(example.prompt),
    answer: joinWords(example.answer),
    explanation: joinWords(example.explanation),
  })),
  commonMistake: {
    incorrect: joinWords(draft.commonMistake.incorrect),
    correction: joinWords(draft.commonMistake.correction),
    explanation: joinWords(draft.commonMistake.explanation),
  },
  guidedPractice: {
    prompt: joinWords(draft.guidedPractice.prompt),
    hint: joinWords(draft.guidedPractice.hint),
    answer: joinWords(draft.guidedPractice.answer),
    explanation: joinWords(draft.guidedPractice.explanation),
  },
}));

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
