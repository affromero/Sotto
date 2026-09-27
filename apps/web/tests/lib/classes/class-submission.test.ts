import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCourseClassFindFirst = vi.fn();
const mockCourseClassUpdate = vi.fn();
const mockClassSectionUpdate = vi.fn();
const mockClassSubmissionUpsert = vi.fn();
const mockCourseUpdate = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    courseClass: {
      findFirst: (...args: unknown[]) => mockCourseClassFindFirst(...args),
      update: (...args: unknown[]) => mockCourseClassUpdate(...args),
    },
    classSection: { update: (...args: unknown[]) => mockClassSectionUpdate(...args) },
    classSubmission: { upsert: (...args: unknown[]) => mockClassSubmissionUpsert(...args) },
    course: { update: (...args: unknown[]) => mockCourseUpdate(...args) },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));
vi.mock('@/lib/knowledge-graph', () => ({ applyReviewOutcome: vi.fn() }));
vi.mock('@/lib/class-generation', () => ({ generateSectionQuestions: vi.fn() }));
vi.mock('@/lib/class-listening-generator', () => ({ generateClassListening: vi.fn() }));
vi.mock('@/lib/class-speaking-generator', () => ({ generateClassSpeaking: vi.fn() }));
vi.mock('@/lib/class-writing-generator', () => ({ generateClassWriting: vi.fn() }));
vi.mock('@/lib/class-source', () => ({ prepareClassSource: vi.fn() }));
vi.mock('@/lib/curriculum-generator', () => ({ ensureCurriculumHasLevelLessons: vi.fn() }));
vi.mock('@/lib/classes/class-intro', () => ({ generateClassIntro: vi.fn() }));
vi.mock('@/lib/course-notes', () => ({ getCourseNote: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { submitClass } from '@/lib/class-service';

const SAMPLE_LESSON = {
  id: 'lesson-1',
  level: 'A1',
  order: 1,
  slug: 'intro',
  objective: 'Learn greetings',
  grammarPoints: ['articles'],
  targetVocab: [{ lemma: 'hola', gloss: 'hello' }],
  title: 'Introduction',
};

// ---- submitClass ----

describe('submitClass', () => {
  const SECTION_ID_GRAMMAR = 'sec-grammar';
  const SECTION_ID_READING = 'sec-reading';

  // 5 questions per section , qPrefix must be unique per section to avoid answer-map collisions
  function makeSection(id: string, skill: string, qPrefix: string, passThreshold = 0.6) {
    return {
      id,
      skill,
      passThreshold,
      questions: [
        { id: `${qPrefix}1`, correctIndex: 0 },
        { id: `${qPrefix}2`, correctIndex: 1 },
        { id: `${qPrefix}3`, correctIndex: 2 },
        { id: `${qPrefix}4`, correctIndex: 0 },
        { id: `${qPrefix}5`, correctIndex: 1 },
      ],
    };
  }

  function makeClass(passThreshold = 0.5) {
    return {
      id: 'class-1',
      courseId: 'course-1',
      passThreshold,
      lesson: SAMPLE_LESSON,
      sections: [
        makeSection(SECTION_ID_GRAMMAR, 'GRAMMAR', 'q'),
        makeSection(SECTION_ID_READING, 'READING', 'r'),
        {
          ...makeSection('sec-listening', 'LISTENING', 'l'),
          episode: { status: 'READY', audioUrl: '/audio.mp3' },
        },
        {
          id: 'sec-speaking',
          skill: 'SPEAKING',
          passThreshold: 0.6,
          questions: [],
          prompts: [{ id: 'sp1', recordings: [{ status: 'SCORED', overallScore: 0.9 }] }],
        },
      ],
    };
  }

  // All 5 correct answers , covers GRAMMAR section (q1-q5) AND READING section (r1-r5)
  const allCorrect = [
    ...[0, 1, 2, 0, 1].map((selectedIndex, index) => ({
      questionId: `l${index + 1}`,
      selectedIndex,
    })),
    { questionId: 'q1', selectedIndex: 0 },
    { questionId: 'q2', selectedIndex: 1 },
    { questionId: 'q3', selectedIndex: 2 },
    { questionId: 'q4', selectedIndex: 0 },
    { questionId: 'q5', selectedIndex: 1 },
    { questionId: 'r1', selectedIndex: 0 },
    { questionId: 'r2', selectedIndex: 1 },
    { questionId: 'r3', selectedIndex: 2 },
    { questionId: 'r4', selectedIndex: 0 },
    { questionId: 'r5', selectedIndex: 1 },
  ];

  // All wrong answers , covers both sections
  const allWrong = [
    { questionId: 'q1', selectedIndex: 3 },
    { questionId: 'q2', selectedIndex: 3 },
    { questionId: 'q3', selectedIndex: 3 },
    { questionId: 'q4', selectedIndex: 3 },
    { questionId: 'q5', selectedIndex: 3 },
    { questionId: 'r1', selectedIndex: 3 },
    { questionId: 'r2', selectedIndex: 3 },
    { questionId: 'r3', selectedIndex: 3 },
    { questionId: 'r4', selectedIndex: 3 },
    { questionId: 'r5', selectedIndex: 3 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockTransaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
    mockClassSectionUpdate.mockResolvedValue({});
    mockClassSubmissionUpsert.mockResolvedValue({});
    mockCourseClassUpdate.mockResolvedValue({});
    mockCourseUpdate.mockResolvedValue({});
  });

  it('returns null when the class is not owned by the user', async () => {
    mockCourseClassFindFirst.mockResolvedValue(null);

    const result = await submitClass('class-1', 'u1', allCorrect);

    expect(result).toBeNull();
  });

  it('grades each section correctly and passes when passedSections/total >= passThreshold', async () => {
    mockCourseClassFindFirst.mockResolvedValue(makeClass(0.5));

    // Both sections get all-correct answers
    const result = await submitClass('class-1', 'u1', allCorrect);

    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
    expect(result!.passedSections).toBe(4);
    expect(result!.totalSections).toBe(4);
    expect(result!.overallScore).toBe(1);
    expect(result!.sections.every((s) => s.passed)).toBe(true);
  });

  it('fails the class when passedSections/total < passThreshold', async () => {
    mockCourseClassFindFirst.mockResolvedValue(makeClass(0.6));

    // Only speaking passes; one of four sections is below the class threshold.
    const result = await submitClass('class-1', 'u1', allWrong);

    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
    expect(result!.passedSections).toBe(1);
    expect(result!.overallScore).toBe(0.25);
  });

  it('passes with mastered oral sections when another section needs work', async () => {
    mockCourseClassFindFirst.mockResolvedValue(makeClass(0.5));

    // Grammar and both oral sections pass; reading still needs work.
    const mixedAnswers = [
      ...allCorrect.filter((answer) => answer.questionId.startsWith('l')),
      { questionId: 'q1', selectedIndex: 0 },
      { questionId: 'q2', selectedIndex: 1 },
      { questionId: 'q3', selectedIndex: 2 },
      { questionId: 'q4', selectedIndex: 0 },
      { questionId: 'q5', selectedIndex: 1 },
      { questionId: 'r1', selectedIndex: 3 },
      { questionId: 'r2', selectedIndex: 3 },
      { questionId: 'r3', selectedIndex: 3 },
      { questionId: 'r4', selectedIndex: 3 },
      { questionId: 'r5', selectedIndex: 3 },
    ];

    const result = await submitClass('class-1', 'u1', mixedAnswers);

    expect(result).not.toBeNull();
    // Both oral sections pass and the aggregate threshold is met.
    expect(result!.passed).toBe(true);
    expect(result!.passedSections).toBe(3);
  });

  it('clears course.activeClassId when class passes', async () => {
    mockCourseClassFindFirst.mockResolvedValue(makeClass(0.5));

    await submitClass('class-1', 'u1', allCorrect);

    expect(mockCourseUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'course-1' },
        data: { activeClassId: null },
      })
    );
  });

  it('does not clear course.activeClassId when class fails', async () => {
    mockCourseClassFindFirst.mockResolvedValue(makeClass(0.6));

    await submitClass('class-1', 'u1', allWrong);

    expect(mockCourseUpdate).not.toHaveBeenCalled();
  });

  it('sets class status to PASSED when passing', async () => {
    mockCourseClassFindFirst.mockResolvedValue(makeClass(0.5));

    await submitClass('class-1', 'u1', allCorrect);

    // The transaction receives an array of promises; since mocks return resolved values
    // we verify the update mock was invoked at all and the outer courseClass.update (status update)
    // happens within the transaction block , we rely on the status value in the final update.
    expect(mockCourseClassUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PASSED' }) })
    );
  });

  it('sets class status to FAILED when failing', async () => {
    mockCourseClassFindFirst.mockResolvedValue(makeClass(0.6));

    await submitClass('class-1', 'u1', allWrong);

    expect(mockCourseClassUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) })
    );
  });

  it('uses -1 as selectedIndex for unanswered questions and scores them wrong', async () => {
    mockCourseClassFindFirst.mockResolvedValue(makeClass(1)); // need 100% to pass

    // Provide no answers at all , all questions get selectedIndex -1
    const result = await submitClass('class-1', 'u1', []);

    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
    expect(result!.passedSections).toBe(1);
  });

  function makeSpeakingClass(
    prompts: Array<{
      id: string;
      recordings: Array<{ status: string; overallScore: number | null }>;
    }>
  ) {
    return {
      id: 'class-1',
      courseId: 'course-1',
      passThreshold: 0.5,
      lesson: SAMPLE_LESSON,
      sections: [
        {
          ...makeSection('sec-listening', 'LISTENING', 'l'),
          episode: { status: 'READY', audioUrl: '/audio.mp3' },
        },
        { id: 'sec-speaking', skill: 'SPEAKING', passThreshold: 0.6, questions: [], prompts },
      ],
    };
  }

  it('scores a SPEAKING section as the average of each prompt latest scored recording', async () => {
    mockCourseClassFindFirst.mockResolvedValue(
      makeSpeakingClass([
        { id: 'p1', recordings: [{ status: 'SCORED', overallScore: 0.9 }] },
        { id: 'p2', recordings: [{ status: 'SCORED', overallScore: 0.7 }] },
      ])
    );

    const result = await submitClass('class-1', 'u1', []);

    const speaking = result!.sections.find((s) => s.skill === 'SPEAKING')!;
    expect(speaking.score).toBeCloseTo(0.8, 5); // (0.9 + 0.7) / 2
    expect(speaking.passed).toBe(true); // 0.8 >= 0.6
  });

  it('keeps a class incomplete until every speaking prompt has feedback', async () => {
    mockCourseClassFindFirst.mockResolvedValue(
      makeSpeakingClass([
        { id: 'p1', recordings: [{ status: 'SCORED', overallScore: 0.9 }] },
        { id: 'p2', recordings: [] },
      ])
    );

    await expect(submitClass('class-1', 'u1', [])).rejects.toThrow(/speaking/i);
    expect(mockCourseClassUpdate).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it.each(['GENERATING_AUDIO', 'FAILED'])(
    'does not complete a class when listening audio is %s',
    async (status) => {
      const cls = makeClass();
      const listening = cls.sections.find((section) => section.skill === 'LISTENING')!;
      Object.assign(listening, { episode: { status, audioUrl: null } });
      mockCourseClassFindFirst.mockResolvedValue(cls);
      await expect(submitClass('class-1', 'u1', allCorrect)).rejects.toThrow(/listening audio/i);
      expect(mockTransaction).not.toHaveBeenCalled();
    }
  );

  it('cannot pass by compensating for failed speaking with other sections', async () => {
    const cls = makeClass(0.7);
    const speaking = cls.sections.find((section) => section.skill === 'SPEAKING')!;
    Object.assign(speaking, {
      prompts: [{ id: 'sp1', recordings: [{ status: 'SCORED', overallScore: 0.1 }] }],
    });
    mockCourseClassFindFirst.mockResolvedValue(cls);
    const result = await submitClass('class-1', 'u1', allCorrect);
    expect(result?.overallScore).toBe(0.75);
    expect(result?.passed).toBe(false);
    expect(mockCourseUpdate).not.toHaveBeenCalled();
  });
});
