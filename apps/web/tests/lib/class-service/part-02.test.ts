import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSkillRequirements } from '@sotto/shared';
import { sampleTeaching } from '../../helpers/learning/class-teaching';
import {
  mockCourseClassFindFirst,
  mockCourseFindFirst,
  mockResolveSkillRequirements,
  mockCourseClassFindUnique,
  mockCourseClassUpdate,
  mockCourseClassDelete,
  mockClassSectionCreate,
  mockClassSectionUpdate,
  mockClassSectionDeleteMany,
  mockLessonQuestionCreate,
  mockClassSubmissionDeleteMany,
  mockCourseUpdate,
  mockCourseUpdateMany,
  mockTransaction,
  mockGenerateSectionQuestions,
  mockGenerateClassIntro,
  mockGenerateClassListening,
  mockGenerateClassSpeaking,
  mockGenerateClassWriting,
  SAMPLE_LESSON,
  SAMPLE_COURSE,
  SAMPLE_QUESTIONS,
  mockDueVocabRows,
  mockCourseMaterialRows,
  mockLearnerVocabFindMany,
} from './fixtures';
import { authorizedLearnerExecution } from '../../helpers/runtime/provider-execution';
import { getClassForUser, regenerateCurrentClass, deleteClassForUser } from '@/lib/class-service';

describe('regenerateCurrentClass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCourseFindFirst.mockResolvedValue(SAMPLE_COURSE);
    mockDueVocabRows.mockResolvedValue([]);
    mockCourseMaterialRows.mockResolvedValue([]);
    mockLearnerVocabFindMany.mockResolvedValue([
      { lemma: 'hola', mastery: 0, reps: 0, lastReviewed: null },
    ]);
    mockResolveSkillRequirements.mockResolvedValue(
      createSkillRequirements({
        scope: 'CLASS',
        nativeLang: 'en',
        targetLang: 'es',
        level: 'A2',
        ttsProvider: 'cartesia',
        sttProvider: 'openai',
      })
    );
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
    mockCourseClassFindUnique.mockResolvedValue({
      status: 'GENERATING',
      attempt: 2,
      course: { userId: 'u1' },
    });
    mockCourseClassUpdate.mockResolvedValue({});
    mockCourseUpdate.mockResolvedValue({});
  });

  it('retains historical material and rebuilds it with a bumped attempt', async () => {
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

    const result = await regenerateCurrentClass('class-1', 'u1', authorizedLearnerExecution('u1'));

    expect(result).toBe(true);
    expect(mockCourseClassUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'class-1' },
        data: expect.objectContaining({ status: 'GENERATING', attempt: 2 }),
      })
    );
    expect(mockClassSubmissionDeleteMany).not.toHaveBeenCalled();
    expect(mockClassSectionDeleteMany).not.toHaveBeenCalled();
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

    const result = await regenerateCurrentClass('class-1', 'u1', authorizedLearnerExecution('u1'));

    expect(result).toBe(false);
    expect(mockClassSectionDeleteMany).not.toHaveBeenCalled();
  });
  it.each(['GRAMMAR', 'LISTENING'] as const)(
    'generates only the retry skill with the captured missed concepts: %s',
    async (skill) => {
      mockCourseClassFindFirst.mockResolvedValue({
        id: 'class-1',
        courseId: 'course-1',
        status: 'GENERATING',
        attempt: 2,
        sourceUrl: null,
        sourceTitle: null,
        lesson: SAMPLE_LESSON,
        course: SAMPLE_COURSE,
        sections: [],
        adaptiveSeed: {
          intro: { purpose: 'Retained goal' },
          teaching: sampleTeaching,
          classTargets: {
            vocab: [{ lemma: 'retained', gloss: 'retained word' }],
            grammarPoints: ['retained grammar'],
          },
        },
      });
      const retry = {
        previousQuestions: [{ question: 'Old question', options: ['A', 'B', 'C', 'D'] }],
        missedQuestions: [
          { question: 'Old question', selectedAnswer: 'B', explanation: 'Review past tense' },
        ],
      };
      let published: unknown;
      const result = await regenerateCurrentClass(
        'class-1',
        'u1',
        authorizedLearnerExecution('u1'),
        undefined,
        {
          repair: true,
          attempt: 2,
          skills: [skill],
          retry,
          publish: async (seed) => {
            published = seed;
          },
        }
      );
      expect(result).toBe(true);
      const generation =
        skill === 'GRAMMAR' ? mockGenerateSectionQuestions : mockGenerateClassListening;
      expect(generation.mock.calls.at(-1)?.[0]).toMatchObject({ retry });
      expect(published).toMatchObject({
        teaching: sampleTeaching,
        classTargets: {
          vocab: [{ lemma: 'retained', gloss: 'retained word' }],
          grammarPoints: ['retained grammar'],
        },
      });
      expect(mockGenerateClassSpeaking).not.toHaveBeenCalled();
      expect(mockGenerateClassWriting).not.toHaveBeenCalled();
      expect(mockGenerateClassIntro).not.toHaveBeenCalled();
      if (skill === 'LISTENING') expect(mockGenerateSectionQuestions).not.toHaveBeenCalled();
      else expect(mockGenerateClassListening).not.toHaveBeenCalled();
    }
  );

  it('settles this attempt as failed when the course acquired another active class', async () => {
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
    mockCourseUpdateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      regenerateCurrentClass('class-1', 'u1', authorizedLearnerExecution('u1'))
    ).rejects.toThrow('active course class changed');
    expect(mockCourseClassUpdate).toHaveBeenLastCalledWith({
      where: { id: 'class-1', attempt: 2, status: 'GENERATING', course: { userId: 'u1' } },
      data: { status: 'FAILED', failedAt: expect.any(Date) },
    });
    expect(mockCourseUpdate).not.toHaveBeenCalled();
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

// Failed and incomplete repair admission is covered with real PostgreSQL in
// classes/preparation-postgres.test.ts; selective material is covered in learning/class-repair.test.ts.

// ---- getClassForUser ----

describe('getClassForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns no class when the learner has no matching owned class', async () => {
    mockCourseClassFindFirst.mockResolvedValue(null);

    expect(await getClassForUser('class-1', 'u1')).toBeNull();

    expect(mockCourseClassFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'class-1', course: { userId: 'u1' } },
      })
    );
  });

  it('returns accepted class teaching and rejects present malformed teaching instead of hiding it', async () => {
    mockCourseClassFindFirst.mockResolvedValue({
      id: 'class-1',
      sections: [],
      adaptiveSeed: { teaching: sampleTeaching },
    });
    expect((await getClassForUser('class-1', 'u1'))?.teaching).toEqual(sampleTeaching);
    mockCourseClassFindFirst.mockResolvedValue({
      id: 'class-1',
      sections: [],
      adaptiveSeed: { teaching: { title: 'Incomplete' } },
    });
    await expect(getClassForUser('class-1', 'u1')).rejects.toThrow();
  });

  it('projects the accepted source vocabulary and grammar instead of the shared curriculum defaults', async () => {
    const classTargets = {
      vocab: [{ lemma: 'Bahnhof', gloss: 'station' }],
      grammarPoints: ['accepted grammar'],
    };
    mockCourseClassFindFirst.mockResolvedValue({
      id: 'class-1',
      sections: [],
      lesson: SAMPLE_LESSON,
      adaptiveSeed: { teaching: sampleTeaching, classTargets },
    });
    const result = await getClassForUser('class-1', 'u1');
    expect(result?.lesson.targetVocab).toEqual(classTargets.vocab);
    expect(result?.lesson.grammarPoints).toEqual(classTargets.grammarPoints);
    expect(SAMPLE_LESSON.targetVocab).toEqual([{ lemma: 'hola', gloss: 'hello' }]);
    mockCourseClassFindFirst.mockResolvedValue({
      id: 'class-1',
      sections: [],
      lesson: SAMPLE_LESSON,
      adaptiveSeed: { classTargets: { vocab: 'invalid' } },
    });
    await expect(getClassForUser('class-1', 'u1')).rejects.toThrow();
  });
});
