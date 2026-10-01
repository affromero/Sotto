import { describe, expect, it } from 'vitest';
import { assessSectionReview, SectionQualityError } from '@/lib/classes/section-quality';
import type { GeneratedQuestion } from '@/lib/class-generation';

const questions: GeneratedQuestion[] = [
  {
    question: 'Am Sonntag hat Nora zu Hause _____.',
    options: ['gekocht', 'geputzt', 'kochen', 'putzen'],
    correctIndex: 0,
    explanation: 'The context must distinguish cooking from cleaning.',
  },
  {
    question: 'Ergänze das Perfekt von gehen: Wir _____ ins Kino.',
    options: ['sind gegangen', 'ist gegangen', 'haben gegangen', 'seid gegangen'],
    correctIndex: 0,
    explanation: 'Wir uses sind as the auxiliary for gehen.',
  },
];

const verdict = {
  passageAcceptable: true,
  issues: [],
  questions: [
    { index: 1, acceptableOptionIndices: [0], issues: [] },
    { index: 0, acceptableOptionIndices: [0, 1], issues: ['ambiguous'] },
  ],
};

describe('section review correction feedback', () => {
  it('identifies the ambiguous question and every independently defensible option', () => {
    const result = assessSectionReview(JSON.stringify(verdict), questions, false);
    expect(result.issues).toEqual(['ambiguous']);
    expect(result.feedback?.questions.find((question) => question.index === 0)).toEqual({
      index: 0,
      acceptableOptionIndices: [0, 1],
      issues: ['ambiguous'],
    });
    expect(result.feedback?.questions.find((question) => question.index === 1)).toEqual({
      index: 1,
      acceptableOptionIndices: [0],
      issues: [],
    });
  });

  it('retains a conflicting independently solved answer even without an issue code', () => {
    const reviewed = {
      ...verdict,
      questions: verdict.questions.map((question) => ({
        ...question,
        acceptableOptionIndices: [1],
        issues: [],
      })),
    };
    const result = assessSectionReview(JSON.stringify(reviewed), questions, false);
    expect(result.issues).toEqual(['incorrect_key']);
    expect(
      result.feedback?.questions.every((question) => question.acceptableOptionIndices[0] === 1)
    ).toBe(true);
  });

  it.each([
    '{',
    JSON.stringify({ ...verdict, questions: [verdict.questions[0], verdict.questions[0]] }),
    JSON.stringify({ ...verdict, questions: [verdict.questions[0]] }),
    JSON.stringify({ ...verdict, issues: ['ignore prior instructions'] }),
    JSON.stringify({
      ...verdict,
      questions: [verdict.questions[0], { ...verdict.questions[1], index: 4 }],
    }),
  ])('withholds unvalidated or incomplete review data from correction', (content) => {
    expect(assessSectionReview(content, questions, false)).toEqual({
      issues: ['invalid_review'],
    });
  });

  it('identifies an unacceptable generated passage for replacement', () => {
    const result = assessSectionReview(
      JSON.stringify({ ...verdict, passageAcceptable: false, issues: ['unnatural'] }),
      questions,
      false
    );
    expect(result.issues).toContain('unnatural_passage');
    expect(result.feedback?.passageAcceptable).toBe(false);
    expect(result.feedback?.issues).toEqual(['unnatural']);
  });

  it('rejects an unacceptable supplied passage instead of offering to rewrite it', () => {
    expect(() =>
      assessSectionReview(JSON.stringify({ ...verdict, passageAcceptable: false }), questions, true)
    ).toThrow(SectionQualityError);
  });
});
