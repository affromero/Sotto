import { describe, expect, it } from 'vitest';
import { classQuizHistory } from '@/lib/learning/classes/progress/quiz-history';

describe('owned class quiz history', () => {
  it('preserves drafts and each submitted answer without treating either as current work', () => {
    const result = classQuizHistory({
      userId: 'owner',
      activeSectionIds: new Set(['current']),
      sections: [
        {
          id: 'old',
          skill: 'GRAMMAR',
          attempt: 1,
          withdrawn: false,
          questions: [
            {
              id: 'q-old',
              order: 1,
              question: 'Saved task',
              passageText: null,
              options: ['yes', 'no'],
            },
          ],
        },
        {
          id: 'current',
          skill: 'READING',
          attempt: 2,
          withdrawn: false,
          questions: [
            {
              id: 'q-current',
              order: 1,
              question: 'Current task',
              passageText: 'Saved passage',
              options: ['a', 'b', 'c'],
            },
          ],
        },
        {
          id: 'private',
          skill: 'LISTENING',
          attempt: 3,
          withdrawn: true,
          questions: [
            {
              id: 'q-private',
              order: 1,
              question: 'Unpublished task',
              passageText: null,
              options: ['a', 'b'],
            },
          ],
        },
      ],
      learnerAnswers: { 'q-old': 0, 'q-current': 1, 'q-private': 1, missing: 3 },
      submission: {
        userId: 'owner',
        attempt: 2,
        submittedAt: new Date('2026-01-02T00:00:00Z'),
        answers: [{ sectionId: 'old', questionId: 'q-old', selectedIndex: 1, isCorrect: false }],
        history: [
          {
            attempt: 1,
            submittedAt: '2026-01-01T00:00:00Z',
            answers: [
              { sectionId: 'old', questionId: 'q-old', selectedIndex: 0, isCorrect: true },
              { sectionId: 'current', questionId: 'q-current', selectedIndex: 2, isCorrect: false },
              { sectionId: 'private', questionId: 'q-private', selectedIndex: 0, isCorrect: true },
              {
                sectionId: 'wrong-section',
                questionId: 'q-old',
                selectedIndex: 1,
                isCorrect: false,
              },
            ],
          },
        ],
      },
    });
    const old = result.quizHistory.find((section) => section.sectionId === 'old')!;
    expect(old.questions[0]).toMatchObject({
      question: 'Saved task',
      options: ['yes', 'no'],
      savedChoice: 0,
      submissions: [
        { attempt: 2, selectedIndex: 1, isCorrect: false },
        { attempt: 1, selectedIndex: 0, isCorrect: true },
      ],
    });
    expect(
      result.quizHistory.find((section) => section.sectionId === 'current')?.questions[0]
    ).toMatchObject({ savedChoice: null, submissions: [{ selectedIndex: 2 }] });
    expect(result.orphanQuizAnswers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ questionId: 'missing', savedChoice: 3 }),
        expect.objectContaining({ questionId: 'q-private', savedChoice: 1 }),
        expect.objectContaining({
          sectionId: 'private',
          questionId: 'q-private',
          submissions: [expect.objectContaining({ selectedIndex: 0 })],
        }),
        expect.objectContaining({ sectionId: 'wrong-section', questionId: 'q-old' }),
      ])
    );
    expect(JSON.stringify(result)).not.toContain('Unpublished task');
    expect(result.quizHistoryUnreadable).toBe(false);
  });

  it('retains valid events beside malformed entries and never exposes another learner submission', () => {
    const input: Parameters<typeof classQuizHistory>[0] = {
      userId: 'owner',
      activeSectionIds: new Set(),
      sections: [
        {
          id: 'old',
          skill: 'READING',
          attempt: 1,
          withdrawn: false,
          questions: [
            { id: 'q', order: 1, question: 'Retained task', passageText: null, options: ['a', 3] },
          ],
        },
      ],
      learnerAnswers: { q: 7, broken: 'not a choice' },
      submission: {
        userId: 'owner',
        attempt: null,
        submittedAt: new Date('2026-01-02T00:00:00Z'),
        answers: [],
        history: [
          {
            attempt: null,
            submittedAt: null,
            answers: [
              { sectionId: 'old', questionId: 'q', selectedIndex: 0, isCorrect: true },
              { sectionId: 'old', questionId: 'q', selectedIndex: 1 },
              { selectedIndex: 2 },
              { sectionId: 'old', questionId: 'q', selectedIndex: 'bad', isCorrect: false },
            ],
          },
          {
            attempt: 4,
            submittedAt: '2026-01-03T00:00:00Z',
            receipt: {
              passed: false,
              overallScore: 0.4,
              passedSections: 1,
              totalSections: 2,
              sections: [
                { id: 'speaking', skill: 'SPEAKING', score: 0.8, passed: true },
                { skill: 'READING', score: 0.7 },
                { skill: 'invalid' },
              ],
            },
            answers: 'invalid',
          },
          {
            attempt: 5,
            submittedAt: null,
            receipt: {
              passed: 'invalid',
              overallScore: null,
              passedSections: 1,
              totalSections: 1,
              sections: [{ id: 'reading', skill: 'READING', score: 0.8, passed: true }],
            },
            answers: [],
          },
        ],
      },
    };
    const result = classQuizHistory(input);
    expect(result.quizHistory[0]!.questions[0]).toMatchObject({
      options: null,
      savedChoice: 7,
      submissions: [
        { attempt: null, submittedAt: null, selectedIndex: 0, isCorrect: true },
        { attempt: null, submittedAt: null, selectedIndex: 1, isCorrect: null },
        { attempt: null, submittedAt: null, selectedIndex: null, isCorrect: false },
      ],
    });
    expect(result.orphanQuizAnswers).toContainEqual({
      sectionId: null,
      questionId: null,
      savedChoice: null,
      submissions: [{ attempt: null, submittedAt: null, selectedIndex: 2, isCorrect: null }],
    });
    expect(result.quizHistoryUnreadable).toBe(true);
    expect(result.quizSubmissionReceipts).toContainEqual(
      expect.objectContaining({
        attempt: null,
        submittedAt: null,
        answersUnavailable: true,
      })
    );
    expect(result.quizSubmissionReceipts).toContainEqual({
      attempt: 4,
      submittedAt: '2026-01-03T00:00:00Z',
      passed: false,
      overallScore: 0.4,
      answersUnavailable: true,
      passedSections: 1,
      totalSections: 2,
      sections: [
        { id: 'speaking', skill: 'SPEAKING', score: 0.8, passed: true },
        { id: null, skill: 'READING', score: 0.7, passed: null },
      ],
      summaryIncomplete: true,
    });
    expect(result.quizSubmissionReceipts).toContainEqual(
      expect.objectContaining({
        attempt: 5,
        passed: null,
        overallScore: null,
        passedSections: 1,
        totalSections: 1,
        summaryIncomplete: true,
      })
    );
    const foreign = classQuizHistory({
      ...input,
      submission: { ...input.submission!, userId: 'another' },
    });
    expect(foreign.quizHistory[0]!.questions[0]!.submissions).toEqual([]);
    expect(foreign.quizHistoryUnreadable).toBe(true);
    const inconsistent = classQuizHistory({
      ...input,
      submission: {
        ...input.submission!,
        overallScore: 5,
        receipt: {
          passedSections: 5,
          totalSections: 2,
          sections: [{ skill: 'GRAMMAR', score: -1 }],
        },
      },
    });
    expect(inconsistent.quizSubmissionReceipts[0]).toMatchObject({
      overallScore: 5,
      passedSections: 5,
      totalSections: 2,
      summaryIncomplete: true,
      sections: [{ id: null, skill: 'GRAMMAR', score: -1, passed: null }],
    });
  });
});
