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
  regenerateCurrentClass,
  regenerateFailedSections,
  deleteClassForUser,
} from '@/lib/class-service';

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
