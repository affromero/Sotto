import { describe, expect, it } from 'vitest';
import {
  assessSectionReview,
  SectionQualityError,
  captureBlindSectionFailure,
  sectionReviewInput,
} from '@/lib/classes/section-quality';
import {
  captureGenerationFailure,
  generationFailureSchema,
} from '@/lib/classes/quality/generation-failure';
import { learningFailureReason } from '@/lib/classes/quality/teaching-failure-store';
import type { GeneratedQuestion } from '@/lib/class-generation';

const questions: GeneratedQuestion[] = [
  {
    question: 'Am Sonntag hat Nora zu Hause _____.',
    options: ['gekocht', 'geputzt', 'kochen', 'putzen'],
    correctIndex: 0,
    explanation: 'The context must distinguish cooking from cleaning.',
  },
  {
    question: 'Ergänze das Perfekt von gehen: Wir _____ ins Kino gegangen.',
    options: ['sind', 'ist', 'haben', 'seid'],
    correctIndex: 0,
    explanation: 'Wir uses sind as the auxiliary for gehen.',
  },
];

const verdict = {
  passageAcceptable: true,
  passageFeedback: [],
  issues: [],
  questions: [
    { index: 1, acceptableOptionIndices: [0], issues: [] },
    { index: 0, acceptableOptionIndices: [0, 1], issues: ['ambiguous'] },
  ],
};

const passageQuestions = questions.map((question) => ({
  ...question,
  passageText: 'Private exact script.',
}));
const rejected = {
  ...verdict,
  passageAcceptable: false,
  issues: ['unnatural'],
  passageFeedback: [
    { quote: 'Private exact script.', reason: 'The supplied wording is unnatural.' },
  ],
};

describe('section review correction feedback', () => {
  it('shows every literal gap completion without exposing the proposed key or explanation', () => {
    const question = {
      question: 'Am Samstag _____ wir einen kleinen Kuchen für Oma.',
      options: ['haben gebacken', 'sind gebacken', 'haben gebackt', 'sind backen'],
      correctIndex: 0,
      explanation: 'Private proposed explanation.',
    };
    const input = JSON.parse(sectionReviewInput([question]));
    expect(input.questions[0].completedOptions).toEqual([
      'Am Samstag haben gebacken wir einen kleinen Kuchen für Oma.',
      'Am Samstag sind gebacken wir einen kleinen Kuchen für Oma.',
      'Am Samstag haben gebackt wir einen kleinen Kuchen für Oma.',
      'Am Samstag sind backen wir einen kleinen Kuchen für Oma.',
    ]);
    expect(input.questions[0]).not.toHaveProperty('correctIndex');
    expect(input.questions[0]).not.toHaveProperty('explanation');
    expect(sectionReviewInput([question])).not.toContain(question.explanation);
    const corrected = {
      ...question,
      question: 'Am Samstag _____ wir einen kleinen Kuchen für Oma gebacken.',
      options: ['haben', 'sind', 'hat', 'ist'],
    };
    expect(JSON.parse(sectionReviewInput([corrected])).questions[0].completedOptions[0]).toBe(
      'Am Samstag haben wir einen kleinen Kuchen für Oma gebacken.'
    );
  });

  it('preserves literal replacement text and omits completions when gap placement is unspecified', () => {
    const literal = {
      ...questions[0],
      question: 'Das Zeichen heißt _____.',
      options: ['$&', '$`', "$'", '$$'],
    };
    expect(JSON.parse(sectionReviewInput([literal])).questions[0].completedOptions).toEqual([
      'Das Zeichen heißt $&.',
      'Das Zeichen heißt $`.',
      "Das Zeichen heißt $'.",
      'Das Zeichen heißt $$.',
    ]);
    const unfilled = questions.map((question, index) => ({
      ...question,
      question: index === 0 ? 'Welche Aussage passt?' : 'Wir _____ gestern _____.',
    }));
    expect(
      JSON.parse(sectionReviewInput(unfilled)).questions.every(
        (question: { completedOptions?: string[] }) => question.completedOptions === undefined
      )
    ).toBe(true);
  });

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
    const result = assessSectionReview(JSON.stringify(rejected), passageQuestions, false);
    expect(result.issues).toContain('unnatural_passage');
    expect(result.feedback?.passageAcceptable).toBe(false);
    expect(result.feedback?.issues).toEqual(['unnatural']);
  });

  it('rejects an unacceptable supplied passage instead of offering to rewrite it', () => {
    expect(() => assessSectionReview(JSON.stringify(rejected), passageQuestions, true)).toThrow(
      SectionQualityError
    );
    try {
      assessSectionReview(JSON.stringify(rejected), passageQuestions, true);
    } catch (error) {
      expect((error as SectionQualityError).blindReviewFailure).toBeUndefined();
    }
  });

  it('retains exact blind evidence in the existing private envelope without leaking it publicly', () => {
    const exact = rejected;
    const material = questions.map((question) => ({
      ...question,
      passageText: 'Private exact script.',
    }));
    let error: unknown;
    try {
      assessSectionReview(JSON.stringify(exact), material, true, 'listening');
    } catch (failure) {
      error = failure;
    }
    expect(error).toBeInstanceOf(SectionQualityError);
    expect(JSON.stringify(error)).not.toContain('Private');
    const captured = captureGenerationFailure(error);
    expect(captured.category).toBe('section_quality');
    expect(generationFailureSchema.parse(captured)).toEqual(captured);
    const record = JSON.parse(captured.teachingFailure!.reviews[0].candidate!);
    expect(record).toEqual({
      reviewType: 'blind_section',
      verdictType: 'derived_compatibility_summary',
      blindVerdict: exact,
      transcript: 'Private exact script.',
      questions,
    });
    expect(
      captured.teachingFailure!.reviews[0].verdict.items.every((item) => !item.acceptable)
    ).toBe(true);
    expect(learningFailureReason(captured)).not.toContain('Private');
    expect(learningFailureReason(captured)).not.toContain('blindVerdict');
  });

  it('retains the complete exact verdict when oversized script material is explicitly omitted', () => {
    const evidence = captureBlindSectionFailure(
      questions.map((question) => ({ ...question, passageText: 'ä'.repeat(32768) })),
      verdict as Parameters<typeof captureBlindSectionFailure>[1]
    );
    const record = JSON.parse(evidence.reviews[0].candidate!);
    expect(record.blindVerdict).toEqual(verdict);
    expect(record.transcript).toBeNull();
    expect(record.questions).toBeNull();
    expect(record.omitted).toBe('size_limit');
    expect(Buffer.byteLength(evidence.reviews[0].candidate!, 'utf8')).toBeLessThan(32768);
  });

  it.each([
    { ...verdict, questions: [verdict.questions[0], verdict.questions[0]] },
    {
      ...verdict,
      questions: verdict.questions.map((item) => ({ ...item, acceptableOptionIndices: [0, 0] })),
    },
    {
      ...verdict,
      questions: [{ ...verdict.questions[0], acceptableOptionIndices: [4] }, verdict.questions[1]],
    },
  ])('does not attach malformed blind verdicts as correction evidence', (invalid) => {
    expect(assessSectionReview(JSON.stringify(invalid), questions, true, 'listening')).toEqual({
      issues: ['invalid_review'],
    });
  });

  it.each([
    ['missing feedback', undefined],
    ['empty feedback', []],
    ['whitespace quote', [{ quote: ' \t', reason: 'Incorrect grammar.' }]],
    ['whitespace reason', [{ quote: 'Private', reason: ' \t' }]],
    ['oversized quote', [{ quote: 'x'.repeat(241), reason: 'Incorrect grammar.' }]],
    ['oversized reason', [{ quote: 'Private', reason: 'x'.repeat(301) }]],
    ['invented quote', [{ quote: 'An invented sentence.', reason: 'Incorrect grammar.' }]],
    ['changed quote case', [{ quote: 'private exact script.', reason: 'Incorrect grammar.' }]],
    ['too many records', Array(4).fill({ quote: 'Private', reason: 'Incorrect grammar.' })],
  ])(
    'withholds %s from immutable rejection and private correction evidence',
    (name, passageFeedback) => {
      const content = JSON.stringify({ ...rejected, passageFeedback });
      expect(() => assessSectionReview(content, passageQuestions, true, 'listening'), name).toThrow(
        SectionQualityError
      );
      try {
        assessSectionReview(content, passageQuestions, true, 'listening');
      } catch (error) {
        expect((error as SectionQualityError).blindReviewFeedback).toBeUndefined();
        expect((error as SectionQualityError).blindReviewFailure).toBeUndefined();
      }
    }
  );

  it.each([
    { ...rejected, passageAcceptable: true },
    { ...rejected, issues: [] },
  ])('validates the complete protocol before rejecting immutable passage text', (invalid) => {
    expect(() =>
      assessSectionReview(JSON.stringify(invalid), passageQuestions, true, 'listening')
    ).toThrow(SectionQualityError);
  });

  it('preserves exact whitespace and Unicode in private feedback without normalizing invented excerpts', () => {
    const passage = 'HOST:  Grüße, wir sind gegangen.  EXPERT: Ja.';
    const material = questions.map((question) => ({ ...question, passageText: passage }));
    const feedback = [
      { quote: '  Grüße, wir sind gegangen.  ', reason: 'A specific attributed issue.' },
    ];
    const review = { ...rejected, passageFeedback: feedback };
    expect(
      assessSectionReview(JSON.stringify(review), material, false).feedback?.passageFeedback
    ).toEqual(feedback);
    const evidence = captureBlindSectionFailure(
      material,
      review as Parameters<typeof captureBlindSectionFailure>[1]
    );
    expect(JSON.parse(evidence.reviews[0].candidate!).blindVerdict.passageFeedback).toEqual(
      feedback
    );
    expect(() =>
      assessSectionReview(
        JSON.stringify({
          ...review,
          passageFeedback: [{ ...feedback[0], quote: '  Gru\u0308ße, wir sind gegangen.  ' }],
        }),
        material,
        true,
        'listening'
      )
    ).toThrow(SectionQualityError);
  });

  it('accepts empty grammar passage metadata while retaining question-only rejection', () => {
    const result = assessSectionReview(JSON.stringify(verdict), questions, true);
    expect(result.issues).toEqual(['ambiguous']);
    expect(result.feedback?.passageFeedback).toEqual([]);
    expect(() =>
      assessSectionReview(JSON.stringify(rejected), questions, true, 'listening')
    ).toThrow(SectionQualityError);
  });

  it('withholds incomplete question identities before attaching passage rejection evidence', () => {
    const invalid = { ...rejected, questions: [verdict.questions[0], verdict.questions[0]] };
    expect(
      assessSectionReview(JSON.stringify(invalid), passageQuestions, true, 'listening')
    ).toEqual({ issues: ['invalid_review'] });
  });
});
