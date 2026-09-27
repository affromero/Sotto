import { describe, expect, it } from 'vitest';
import { assessLearningOutput } from '../../../scripts/learning-evaluation/evaluate';
import { evaluationCases } from '../../../scripts/learning-evaluation/cases';

describe('synthetic learning evaluation', () => {
  it.each(evaluationCases)('accepts the reviewed fixture for $id', (test) => {
    expect(assessLearningOutput(test, JSON.stringify(test.fixture))).toEqual([]);
  });
  it('rejects malformed and incomplete structured responses', () => {
    expect(assessLearningOutput(evaluationCases[0], 'not json')).toEqual(['invalid-json']);
    expect(assessLearningOutput(evaluationCases[0], '{}')).toEqual(['invalid-schema']);
  });
  it('detects missed grammar errors and overcorrection', () => {
    expect(
      assessLearningOutput(
        evaluationCases[1],
        JSON.stringify({ correct: true, correction: '', explanation: 'Good' })
      )
    ).toEqual(['missed-agreement-error', 'incorrect-correction']);
    expect(
      assessLearningOutput(
        evaluationCases[2],
        JSON.stringify({ correct: false, correction: 'changed', explanation: 'Wrong' })
      )
    ).toEqual(['overcorrected-valid-answer']);
  });
  it('detects missing lesson vocabulary and unsupported literal answers', () => {
    expect(
      assessLearningOutput(
        evaluationCases[0],
        JSON.stringify({
          level: 'A1',
          text: 'Ana duerme.',
          question: '¿Qué compra?',
          answer: 'pan',
        })
      )
    ).toEqual(['passage-word-budget', 'target-vocabulary', 'literal-answer-support']);
  });
});
