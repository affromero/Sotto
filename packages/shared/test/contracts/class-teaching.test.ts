import { describe, expect, it } from 'vitest';
import { classTeachingSchema } from '../../src/contracts/class-teaching';
import { classDetailResponseSchema } from '../../src/contracts/schemas';

const teaching = {
  version: 1,
  title: 'A missed train',
  explanation: 'Explain what happened before you arrived at the station.',
  workedExamples: [
    {
      prompt: 'Report the journey.',
      answer: 'Ich bin zum Bahnhof gefahren.',
      explanation: 'Fahren uses sein here because the person travelled to another place.',
    },
    {
      prompt: 'Report the purchase.',
      answer: 'Ich habe eine Fahrkarte gekauft.',
      explanation: 'Kaufen uses haben. The participle closes this statement.',
    },
  ],
  commonMistake: {
    incorrect: 'Ich habe zum Bahnhof gefahren.',
    correction: 'Ich bin zum Bahnhof gefahren.',
    explanation: 'Use sein for this journey.',
  },
  guidedPractice: {
    prompt: 'Report that Mia travelled home.',
    hint: 'Choose the auxiliary for the journey before adding the participle.',
    answer: 'Mia ist nach Hause gefahren.',
    explanation: 'The auxiliary agrees with Mia; gefahren stays at the end.',
  },
} as const;

const historicalClass = {
  id: 'class-1',
  courseId: 'course-1',
  status: 'AVAILABLE',
  order: 9,
  passThreshold: 0.7,
  submitted: false,
  sections: [],
};

describe('class lesson contract', () => {
  it('retains worked examples and guided practice in the class response', () => {
    const parsed = classDetailResponseSchema.parse({ ...historicalClass, teaching });
    expect(parsed.teaching).toEqual(teaching);
  });

  it('loads historical classes without inventing a lesson', () => {
    const parsed = classDetailResponseSchema.parse(historicalClass);
    expect(parsed).not.toHaveProperty('teaching');
  });

  it('rejects incomplete teaching instead of publishing a quiz-only lesson', () => {
    const incomplete = { ...teaching, workedExamples: [], explanation: '' };
    expect(classTeachingSchema.safeParse(incomplete).success).toBe(false);
    expect(
      classDetailResponseSchema.safeParse({ ...historicalClass, teaching: incomplete }).success
    ).toBe(false);
  });
});
