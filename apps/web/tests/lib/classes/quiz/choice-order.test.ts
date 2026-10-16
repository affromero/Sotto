import { describe, expect, it } from 'vitest';
import { orderQuizChoices } from '@/lib/classes/quiz/choice-order';

describe('published quiz choices', () => {
  const questions = Array.from({ length: 5 }, (_, index) => ({
    question: 'Question ' + index,
    options: ['right', 'near', 'other', 'different'],
    correctIndex: 0,
  }));

  it('preserves the answer and all choices while avoiding one predictable answer position', () => {
    const result = orderQuizChoices(questions, 'owned-class-GRAMMAR-1');
    expect(new Set(result.map(({ correctIndex }) => correctIndex)).size).toBeGreaterThan(1);
    for (const question of result) {
      expect(question.options[question.correctIndex]).toBe('right');
      expect([...question.options].sort()).toEqual([...questions[0].options].sort());
    }
    expect(questions.every(({ correctIndex }) => correctIndex === 0)).toBe(true);
    expect(orderQuizChoices(result, 'owned-class-GRAMMAR-1')).toEqual(result);
    const otherClass = orderQuizChoices(questions, 'another-class-GRAMMAR-2');
    expect(new Set(otherClass.map(({ correctIndex }) => correctIndex)).size).toBeGreaterThan(1);
    expect(otherClass).not.toEqual(result);
  });
});
