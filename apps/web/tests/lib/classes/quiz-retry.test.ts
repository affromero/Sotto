import { describe, expect, it } from 'vitest';
import { assertFreshQuizQuestions, QuizRetryRepetitionError } from '@/lib/classes/quiz/retry';

const shown = {
  question: 'Choose the past tense.\nIch habe gestern meine Freundin besucht.',
  options: ['A', 'B'],
};
const retry = { previousQuestions: [shown], missedQuestions: [] };

describe('fresh question identity', () => {
  it.each([
    'Choose differently.\nIch habe gestern meine Freundin besucht.',
    '  ICH habe gestern meine Freundin besucht! ',
    'Ich habe gestern meine Freundin besucht.',
  ])('rejects a shown item with changed task context, punctuation or case: %s', (question) => {
    expect(() => assertFreshQuizQuestions([{ question, options: ['B', 'A'] }], retry)).toThrow(
      QuizRetryRepetitionError
    );
  });

  it('accepts a new situation using the same vocabulary and answer choices', () => {
    expect(() =>
      assertFreshQuizQuestions(
        [{ question: 'Wir haben am Samstag unsere Freunde besucht.', options: shown.options }],
        retry
      )
    ).not.toThrow();
  });

  it('rejects repetitions inside the newly generated exercise', () => {
    expect(() =>
      assertFreshQuizQuestions(
        [
          { question: 'Was hast du am Samstag gemacht?', options: ['A', 'B'] },
          { question: 'WAS hast du am Samstag gemacht!', options: ['B', 'A'] },
        ],
        retry
      )
    ).toThrow(QuizRetryRepetitionError);
  });
});
