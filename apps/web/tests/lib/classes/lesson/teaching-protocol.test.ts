import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { classTeachingSchema, type ClassTeaching } from '@sotto/shared';
import { classTeachingAuthoringSchema } from '@/lib/classes/lesson/teaching-protocol';
import { countWords } from '@/lib/duration';
import { sampleTeaching } from '../../../helpers/learning/class-teaching';

const validateWire = new Ajv().compile(
  classTeachingAuthoringSchema.toJSONSchema({ target: 'draft-7' })
);
const words = (count: number) => Array.from({ length: count }, () => 'idea').join(' \t\n');
const fields: Array<{
  field: string;
  maximum: number;
  write: (unit: ClassTeaching, text: string) => void;
}> = [
  {
    field: 'title',
    maximum: 10,
    write: (unit, text) => {
      unit.title = text;
    },
  },
  {
    field: 'explanation',
    maximum: 170,
    write: (unit, text) => {
      unit.explanation = text;
    },
  },
  {
    field: 'worked prompt',
    maximum: 25,
    write: (unit, text) => {
      unit.workedExamples[0]!.prompt = text;
    },
  },
  {
    field: 'worked answer',
    maximum: 35,
    write: (unit, text) => {
      unit.workedExamples[0]!.answer = text;
    },
  },
  {
    field: 'worked explanation',
    maximum: 25,
    write: (unit, text) => {
      unit.workedExamples[0]!.explanation = text;
    },
  },
  {
    field: 'incorrect example',
    maximum: 15,
    write: (unit, text) => {
      unit.commonMistake.incorrect = text;
    },
  },
  {
    field: 'corrected example',
    maximum: 15,
    write: (unit, text) => {
      unit.commonMistake.correction = text;
    },
  },
  {
    field: 'mistake explanation',
    maximum: 25,
    write: (unit, text) => {
      unit.commonMistake.explanation = text;
    },
  },
  {
    field: 'guided prompt',
    maximum: 30,
    write: (unit, text) => {
      unit.guidedPractice.prompt = text;
    },
  },
  {
    field: 'guided hint',
    maximum: 15,
    write: (unit, text) => {
      unit.guidedPractice.hint = text;
    },
  },
  {
    field: 'guided answer',
    maximum: 35,
    write: (unit, text) => {
      unit.guidedPractice.answer = text;
    },
  },
  {
    field: 'guided explanation',
    maximum: 25,
    write: (unit, text) => {
      unit.guidedPractice.explanation = text;
    },
  },
];

function totalWords(unit: ClassTeaching) {
  return countWords(
    [
      unit.title,
      unit.explanation,
      ...unit.workedExamples.flatMap((item) => Object.values(item)),
      ...Object.values(unit.commonMistake),
      ...Object.values(unit.guidedPractice),
    ].join(' ')
  );
}

describe('teaching authoring reading budget', () => {
  it.each(fields)(
    'enforces the $field word boundary in the provider schema and local compiler',
    ({ maximum, write }) => {
      const unit = structuredClone(sampleTeaching);
      write(unit, words(maximum));
      expect(countWords(words(maximum))).toBe(maximum);
      expect(validateWire(unit)).toBe(true);
      expect(classTeachingAuthoringSchema.safeParse(unit).success).toBe(true);
      write(unit, words(maximum + 1));
      expect(validateWire(unit)).toBe(false);
      expect(classTeachingAuthoringSchema.safeParse(unit).success).toBe(false);
      expect(classTeachingSchema.safeParse(unit).success).toBe(true);
    }
  );

  it('fits a complete three-example unit below 600 words even when every field reaches its maximum', () => {
    const unit = structuredClone(sampleTeaching);
    for (const { maximum, write } of fields) write(unit, words(maximum));
    unit.workedExamples = Array.from({ length: 3 }, () => structuredClone(unit.workedExamples[0]!));
    expect(validateWire(unit)).toBe(true);
    expect(classTeachingAuthoringSchema.parse(unit)).toEqual(unit);
    expect(totalWords(unit)).toBe(595);
    unit.workedExamples.pop();
    expect(classTeachingAuthoringSchema.safeParse(unit).success).toBe(true);
    expect(totalWords(unit)).toBe(510);
  });

  it('retains the existing character caps and rejects incomplete or extra teaching fields', () => {
    for (const unit of [
      { ...sampleTeaching, title: 'x'.repeat(161) },
      { ...sampleTeaching, explanation: 'x'.repeat(1801) },
      { ...sampleTeaching, workedExamples: [sampleTeaching.workedExamples[0]] },
      { ...sampleTeaching, guidedPractice: undefined },
      { ...sampleTeaching, extra: 'untrusted' },
    ]) {
      expect(validateWire(unit)).toBe(false);
      expect(classTeachingAuthoringSchema.safeParse(unit).success).toBe(false);
    }
  });
});
