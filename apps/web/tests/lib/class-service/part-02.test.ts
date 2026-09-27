import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  mockCourseClassFindFirst,
  mockCourseClassFindUnique,
  mockCourseClassUpdate,
  mockCourseClassDelete,
  mockClassSectionCreate,
  mockClassSectionUpdate,
  mockClassSectionDeleteMany,
  mockLessonQuestionCreate,
  mockLessonQuestionDeleteMany,
  mockSpeakingRecordingDeleteMany,
  mockClassSubmissionUpsert,
  mockClassSubmissionDeleteMany,
  mockCourseUpdate,
  mockTransaction,
  mockGenerateSectionQuestions,
  mockGenerateClassIntro,
  mockGenerateClassListening,
  mockGenerateClassSpeaking,
  mockGenerateClassWriting,
  SAMPLE_LESSON,
  SAMPLE_COURSE,
  SAMPLE_QUESTIONS,
} from './fixtures';
import { blockedProviderExecution } from '../../helpers/runtime/provider-execution';
import {
  getClassForUser,
  submitClass,
  regenerateCurrentClass,
  regenerateFailedSections,
  deleteClassForUser,
} from '@/lib/class-service';

describe('submitClass', () => {
  const SECTION_ID_GRAMMAR = 'sec-grammar';
  const SECTION_ID_READING = 'sec-reading';

  // 5 questions per section — qPrefix must be unique per section to avoid answer-map collisions
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
      ],
    };
  }

  // All 5 correct answers — covers GRAMMAR section (q1-q5) AND READING section (r1-r5)
  const allCorrect = [
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

  // All wrong answers — covers both sections
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
    expect(result!.passedSections).toBe(2);
    expect(result!.totalSections).toBe(2);
    expect(result!.overallScore).toBe(1);
    expect(result!.sections.every((s) => s.passed)).toBe(true);
  });

  it('fails the class when passedSections/total < passThreshold', async () => {
    mockCourseClassFindFirst.mockResolvedValue(makeClass(0.6));

    // Both sections get all-wrong answers → 0 passed sections, 0/2 < 0.6
    const result = await submitClass('class-1', 'u1', allWrong);

    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
    expect(result!.passedSections).toBe(0);
    expect(result!.overallScore).toBe(0);
  });

  it('partially passes: 1 of 2 sections at the exact threshold (0.5)', async () => {
    mockCourseClassFindFirst.mockResolvedValue(makeClass(0.5));

    // GRAMMAR (q prefix) all-correct, READING (r prefix) all-wrong → 1/2 = 0.5 >= 0.5
    const mixedAnswers = [
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
    // 1/2 = 0.5 >= 0.5 threshold → class passes
    expect(result!.passed).toBe(true);
    expect(result!.passedSections).toBe(1);
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
    // happens within the transaction block — we rely on the status value in the final update.
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

    // Provide no answers at all — all questions get selectedIndex -1
    const result = await submitClass('class-1', 'u1', []);

    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
    expect(result!.passedSections).toBe(0);
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

  it('counts an unrecorded SPEAKING prompt as 0 in the average', async () => {
    mockCourseClassFindFirst.mockResolvedValue(
      makeSpeakingClass([
        { id: 'p1', recordings: [{ status: 'SCORED', overallScore: 0.9 }] },
        { id: 'p2', recordings: [] },
      ])
    );

    const result = await submitClass('class-1', 'u1', []);

    const speaking = result!.sections.find((s) => s.skill === 'SPEAKING')!;
    expect(speaking.score).toBeCloseTo(0.45, 5); // (0.9 + 0) / 2
    expect(speaking.passed).toBe(false);
  });
});

// ---- regenerateCurrentClass ----

describe('regenerateCurrentClass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
    mockGenerateSectionQuestions.mockResolvedValue(SAMPLE_QUESTIONS);
    mockGenerateClassListening.mockResolvedValue({
      sectionId: 'section-listening',
      episodeId: 'episode-listening',
    });
    mockGenerateClassSpeaking.mockResolvedValue({ sectionId: 'section-speaking' });
    mockGenerateClassWriting.mockResolvedValue({ sectionId: 'section-writing' });
    mockGenerateClassIntro.mockResolvedValue({
      purpose: 'Purpose',
      about: 'About',
      focus: ['Focus'],
      examples: [{ target: 'Hola', meaning: 'Hello', note: 'Greeting' }],
      tips: ['Tip'],
    });
    mockClassSectionCreate.mockImplementation(
      ({ data }: { data: { skill: string; seed: string } }) =>
        Promise.resolve({
          id: `section-${data.skill}`,
          seed: data.seed,
          skill: data.skill,
        })
    );
    mockClassSectionUpdate.mockResolvedValue({});
    mockClassSectionDeleteMany.mockResolvedValue({ count: 4 });
    mockClassSubmissionDeleteMany.mockResolvedValue({ count: 1 });
    mockLessonQuestionCreate.mockResolvedValue({});
    mockCourseClassFindUnique.mockResolvedValue({ status: 'GENERATING' });
    mockCourseClassUpdate.mockResolvedValue({});
    mockCourseUpdate.mockResolvedValue({});
  });

  it('clears the current class and rebuilds it with a bumped attempt', async () => {
    mockCourseClassFindFirst.mockResolvedValue({
      id: 'class-1',
      courseId: 'course-1',
      status: 'AVAILABLE',
      attempt: 1,
      sourceUrl: null,
      sourceTitle: null,
      lesson: SAMPLE_LESSON,
      course: SAMPLE_COURSE,
    });

    const result = await regenerateCurrentClass('class-1', 'u1', blockedProviderExecution('u1'));

    expect(result).toBe(true);
    expect(mockCourseClassUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'class-1' },
        data: expect.objectContaining({ status: 'GENERATING', attempt: 2 }),
      })
    );
    expect(mockClassSubmissionDeleteMany).toHaveBeenCalledWith({ where: { classId: 'class-1' } });
    expect(mockClassSectionDeleteMany).toHaveBeenCalledWith({ where: { classId: 'class-1' } });
    expect(mockClassSectionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ skill: 'GRAMMAR', attempt: 2, seed: 'class-1-GRAMMAR-2' }),
      })
    );
    expect(mockCourseClassUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'class-1' },
        data: expect.objectContaining({ status: 'AVAILABLE' }),
      })
    );
  });

  it('returns false for a passed class', async () => {
    mockCourseClassFindFirst.mockResolvedValue({
      id: 'class-1',
      status: 'PASSED',
      attempt: 1,
      lesson: SAMPLE_LESSON,
      course: SAMPLE_COURSE,
    });

    const result = await regenerateCurrentClass('class-1', 'u1', blockedProviderExecution('u1'));

    expect(result).toBe(false);
    expect(mockClassSectionDeleteMany).not.toHaveBeenCalled();
  });
});

// ---- deleteClassForUser ----

describe('deleteClassForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
    mockCourseClassDelete.mockResolvedValue({});
    mockCourseUpdate.mockResolvedValue({});
  });

  it('returns false when the class is not owned by the user', async () => {
    mockCourseClassFindFirst.mockResolvedValue(null);

    const result = await deleteClassForUser('class-1', 'u1');

    expect(result).toBe(false);
    expect(mockCourseClassDelete).not.toHaveBeenCalled();
  });

  it('deletes the class and clears activeClassId when needed', async () => {
    mockCourseClassFindFirst.mockResolvedValue({
      id: 'class-1',
      courseId: 'course-1',
      course: { activeClassId: 'class-1' },
    });

    const result = await deleteClassForUser('class-1', 'u1');

    expect(result).toBe(true);
    expect(mockCourseClassDelete).toHaveBeenCalledWith({ where: { id: 'class-1' } });
    expect(mockCourseUpdate).toHaveBeenCalledWith({
      where: { id: 'course-1' },
      data: { activeClassId: null },
    });
  });
});

// ---- regenerateFailedSections ----

describe('regenerateFailedSections', () => {
  const execution = blockedProviderExecution('u1');
  const FAILED_SECTION = {
    id: 'sec-grammar',
    skill: 'GRAMMAR',
    attempt: 1,
    passThreshold: 0.6,
    passed: false,
  };

  const SAMPLE_CLASS_WITH_FAILED = {
    id: 'class-1',
    courseId: 'course-1',
    sections: [FAILED_SECTION],
    lesson: SAMPLE_LESSON,
    course: {
      nativeLang: 'en',
      targetLang: 'es',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockTransaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
    mockGenerateSectionQuestions.mockResolvedValue(SAMPLE_QUESTIONS);
    mockClassSectionUpdate.mockResolvedValue({});
    mockLessonQuestionDeleteMany.mockResolvedValue({});
    mockLessonQuestionCreate.mockResolvedValue({});
    mockCourseClassUpdate.mockResolvedValue({});
  });

  it('returns false when the class is not found or not owned by the user', async () => {
    mockCourseClassFindFirst.mockResolvedValue(null);

    const result = await regenerateFailedSections('class-1', 'u1', execution);

    expect(result).toBe(false);
  });

  it('returns false when there are no failed sections', async () => {
    mockCourseClassFindFirst.mockResolvedValue({
      ...SAMPLE_CLASS_WITH_FAILED,
      sections: [], // no failed sections (Prisma filtered them out)
    });

    const result = await regenerateFailedSections('class-1', 'u1', execution);

    expect(result).toBe(false);
  });

  it('returns true and bumps the attempt for each failed section', async () => {
    mockCourseClassFindFirst.mockResolvedValue(SAMPLE_CLASS_WITH_FAILED);

    const result = await regenerateFailedSections('class-1', 'u1', execution);

    expect(result).toBe(true);
    // attempt should be bumped to 2
    expect(mockClassSectionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sec-grammar' },
        data: expect.objectContaining({ attempt: 2, seed: 'class-1-GRAMMAR-2' }),
      })
    );
  });

  it('deletes old questions and creates new ones for each failed section', async () => {
    mockCourseClassFindFirst.mockResolvedValue(SAMPLE_CLASS_WITH_FAILED);

    await regenerateFailedSections('class-1', 'u1', execution);

    expect(mockLessonQuestionDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sectionId: 'sec-grammar' } })
    );
    expect(mockGenerateSectionQuestions).toHaveBeenCalledTimes(1);
    // New questions should be created inside $transaction
    expect(mockLessonQuestionCreate).toHaveBeenCalledTimes(SAMPLE_QUESTIONS.length);
  });

  it('sets the class status back to IN_PROGRESS after regeneration', async () => {
    mockCourseClassFindFirst.mockResolvedValue(SAMPLE_CLASS_WITH_FAILED);

    await regenerateFailedSections('class-1', 'u1', execution);

    expect(mockCourseClassUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'class-1' },
        data: expect.objectContaining({ status: 'IN_PROGRESS', failedAt: null }),
      })
    );
  });

  it('handles multiple failed sections and regenerates all', async () => {
    const twoFailed = {
      ...SAMPLE_CLASS_WITH_FAILED,
      sections: [
        { id: 'sec-grammar', skill: 'GRAMMAR', attempt: 2, passed: false },
        { id: 'sec-reading', skill: 'READING', attempt: 2, passed: false },
      ],
    };
    mockCourseClassFindFirst.mockResolvedValue(twoFailed);

    const result = await regenerateFailedSections('class-1', 'u1', execution);

    expect(result).toBe(true);
    expect(mockGenerateSectionQuestions).toHaveBeenCalledTimes(2);
    expect(mockClassSectionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ attempt: 3, seed: 'class-1-GRAMMAR-3' }),
      })
    );
    expect(mockClassSectionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ attempt: 3, seed: 'class-1-READING-3' }),
      })
    );
  });

  it('resets a failed SPEAKING section in place: clears recordings, no MC regeneration', async () => {
    mockCourseClassFindFirst.mockResolvedValue({
      ...SAMPLE_CLASS_WITH_FAILED,
      sections: [{ id: 'sec-speaking', skill: 'SPEAKING', attempt: 1, passed: false }],
    });

    const result = await regenerateFailedSections('class-1', 'u1', execution);

    expect(result).toBe(true);
    expect(mockSpeakingRecordingDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sectionId: 'sec-speaking' } })
    );
    // A speaking section has no MC questions to regenerate.
    expect(mockGenerateSectionQuestions).not.toHaveBeenCalled();
    expect(mockClassSectionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ attempt: 2, seed: 'class-1-SPEAKING-2', status: 'READY' }),
      })
    );
  });
});

// ---- getClassForUser ----

describe('getClassForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates to prisma.courseClass.findFirst with correct where clause', async () => {
    mockCourseClassFindFirst.mockResolvedValue(null);

    await getClassForUser('class-1', 'u1');

    expect(mockCourseClassFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'class-1', course: { userId: 'u1' } },
      })
    );
  });

  it('returns null when class is not found', async () => {
    mockCourseClassFindFirst.mockResolvedValue(null);

    const result = await getClassForUser('class-x', 'u1');

    expect(result).toBeNull();
  });
});
