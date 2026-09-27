import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  mockCourseFindFirst,
  mockCourseClassFindFirst,
  mockCourseClassFindUnique,
  mockCourseClassFindMany,
  mockCourseClassCreate,
  mockCourseClassUpdate,
  mockCourseClassDelete,
  mockClassSectionCreate,
  mockClassSectionUpdate,
  mockClassSectionDeleteMany,
  mockLessonQuestionCreate,
  mockClassSubmissionDeleteMany,
  mockCourseUpdate,
  mockTransaction,
  mockGenerateSectionQuestions,
  mockGenerateClassIntro,
  mockGenerateClassListening,
  mockGenerateClassSpeaking,
  mockGenerateClassWriting,
  mockEnsureCurriculumHasLevelLessons,
  mockPrepareClassSource,
  SAMPLE_LESSON,
  SAMPLE_B1_LESSON,
  SAMPLE_COURSE,
  SAMPLE_QUESTIONS,
} from './fixtures';
import { blockedProviderExecution } from '../../helpers/runtime/provider-execution';
import {
  createNextClass,
  ClassGenerationCancelledError,
  CourseNotFoundError,
} from '@/lib/class-service';

describe('createNextClass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: $transaction runs all ops (each op is already a resolved promise from mocked methods)
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
    mockEnsureCurriculumHasLevelLessons.mockResolvedValue(undefined);
    mockClassSectionCreate.mockImplementation(
      ({ data }: { data: { skill: string; seed: string } }) =>
        Promise.resolve({
          id: `section-${data.skill}`,
          seed: data.seed,
          skill: data.skill,
        })
    );
    mockLessonQuestionCreate.mockResolvedValue({});
    mockClassSectionUpdate.mockResolvedValue({});
    mockClassSectionDeleteMany.mockResolvedValue({ count: 0 });
    mockClassSubmissionDeleteMany.mockResolvedValue({ count: 0 });
    mockCourseClassCreate.mockResolvedValue({ id: 'class-new' });
    mockCourseClassDelete.mockResolvedValue({});
    mockCourseClassFindUnique.mockResolvedValue({ status: 'GENERATING' });
    mockCourseClassUpdate.mockResolvedValue({});
    mockCourseUpdate.mockResolvedValue({});
  });

  it('throws CourseNotFoundError when the course does not belong to the user', async () => {
    mockCourseFindFirst.mockResolvedValue(null);

    await expect(
      createNextClass('course-1', 'u1', blockedProviderExecution('u1'))
    ).rejects.toBeInstanceOf(CourseNotFoundError);
  });

  it('returns {kind:"gated"} when a non-PASSED class already exists', async () => {
    mockCourseFindFirst.mockResolvedValue(SAMPLE_COURSE);
    mockCourseClassFindFirst.mockResolvedValue({
      id: 'class-active',
      status: 'IN_PROGRESS',
      lesson: { level: 'A1' },
    });

    const result = await createNextClass('course-1', 'u1', blockedProviderExecution('u1'));

    expect(result).toEqual({ kind: 'gated', activeClassId: 'class-active', status: 'IN_PROGRESS' });
  });

  it('clears a stale below-level active class and creates at the course currentLevel', async () => {
    mockCourseFindFirst.mockResolvedValue({
      ...SAMPLE_COURSE,
      currentLevel: 'B1',
      curriculum: { lessons: [SAMPLE_LESSON, SAMPLE_B1_LESSON] },
    });
    mockCourseClassFindFirst.mockResolvedValue({
      id: 'class-stale-a1',
      status: 'IN_PROGRESS',
      lesson: { level: 'A1' },
    });
    mockCourseClassFindMany.mockResolvedValue([]);
    mockCourseClassDelete.mockResolvedValue({});

    const result = await createNextClass('course-1', 'u1', blockedProviderExecution('u1'));

    expect(result.kind).toBe('created');
    expect(mockCourseClassDelete).toHaveBeenCalledWith({ where: { id: 'class-stale-a1' } });
    expect(mockCourseUpdate).toHaveBeenCalledWith({
      where: { id: 'course-1' },
      data: { activeClassId: null },
    });
    expect(mockCourseClassCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lessonId: 'lesson-b1', order: 15 }),
      })
    );
  });

  it('returns {kind:"done"} when all lessons are passed', async () => {
    mockCourseFindFirst.mockResolvedValue(SAMPLE_COURSE);
    // No active class
    mockCourseClassFindFirst.mockResolvedValue(null);
    // All lessons already passed
    mockCourseClassFindMany.mockResolvedValue([{ lessonId: 'lesson-1' }]);

    const result = await createNextClass('course-1', 'u1', blockedProviderExecution('u1'));

    expect(result).toEqual({ kind: 'done' });
  });

  it('returns {kind:"created"} and creates sections + questions when a new class is needed', async () => {
    mockCourseFindFirst.mockResolvedValue(SAMPLE_COURSE);
    mockCourseClassFindFirst.mockResolvedValue(null);
    // No lessons passed yet
    mockCourseClassFindMany.mockResolvedValue([]);

    const result = await createNextClass('course-1', 'u1', blockedProviderExecution('u1'));

    expect(result.kind).toBe('created');
    expect((result as { kind: 'created'; classId: string }).classId).toBe('class-new');
    // Should have created a class record
    expect(mockCourseClassCreate).toHaveBeenCalled();
    // Should have called generateSectionQuestions for each MC skill (GRAMMAR + READING)
    expect(mockGenerateSectionQuestions).toHaveBeenCalledTimes(2);
    expect(mockGenerateClassIntro).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'A1', title: 'Introduction' })
    );
    // Should have updated course.activeClassId
    expect(mockCourseUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ activeClassId: 'class-new' }) })
    );
  });

  it('publishes through the admitted lifecycle and preserves deferred listening approval', async () => {
    mockCourseFindFirst.mockResolvedValue(SAMPLE_COURSE);
    mockCourseClassFindFirst.mockResolvedValue(null);
    mockCourseClassFindMany.mockResolvedValue([]);
    mockGenerateClassListening.mockImplementation(async (params: { deferAudio?: boolean }) => {
      if (!params.deferAudio) throw new Error('Scheduled audio was not deferred');
      return { sectionId: 'section-listening', episodeId: 'episode-listening' };
    });
    const published: string[] = [];
    const result = await createNextClass(
      'course-1',
      'u1',
      blockedProviderExecution('u1'),
      {},
      {
        deferAudio: true,
        create: async () => ({ id: 'admitted-class' }),
        publish: async (classId) => {
          published.push(classId);
        },
      }
    );
    expect(result).toEqual({ kind: 'created', classId: 'admitted-class' });
    expect(published).toEqual(['admitted-class']);
  });

  it('cleans up the half-built class when generation throws', async () => {
    mockCourseFindFirst.mockResolvedValue(SAMPLE_COURSE);
    mockCourseClassFindFirst.mockResolvedValue(null);
    mockCourseClassFindMany.mockResolvedValue([]);
    mockGenerateSectionQuestions.mockRejectedValue(new Error('AI failure'));
    mockCourseClassDelete.mockResolvedValue({});

    await expect(createNextClass('course-1', 'u1', blockedProviderExecution('u1'))).rejects.toThrow(
      'AI failure'
    );
    expect(mockCourseClassDelete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'class-new' } })
    );
  });

  it('cleans up the half-built class when a required listening section fails', async () => {
    mockCourseFindFirst.mockResolvedValue(SAMPLE_COURSE);
    mockCourseClassFindFirst.mockResolvedValue(null);
    mockCourseClassFindMany.mockResolvedValue([]);
    mockGenerateClassListening.mockRejectedValue(new Error('TTS unavailable'));
    mockCourseClassDelete.mockResolvedValue({});

    await expect(createNextClass('course-1', 'u1', blockedProviderExecution('u1'))).rejects.toThrow(
      'TTS unavailable'
    );
    expect(mockCourseClassDelete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'class-new' } })
    );
    expect(mockGenerateClassSpeaking).not.toHaveBeenCalled();
    expect(mockGenerateClassWriting).not.toHaveBeenCalled();
  });

  it('stops cleanly when the generated class is cancelled midway', async () => {
    mockCourseFindFirst.mockResolvedValue(SAMPLE_COURSE);
    mockCourseClassFindFirst.mockResolvedValue(null);
    mockCourseClassFindMany.mockResolvedValue([]);
    mockCourseClassFindUnique.mockResolvedValue(null);

    await expect(
      createNextClass('course-1', 'u1', blockedProviderExecution('u1'))
    ).rejects.toBeInstanceOf(ClassGenerationCancelledError);
    expect(mockGenerateSectionQuestions).not.toHaveBeenCalled();
  });

  describe('sourced mode', () => {
    const SOURCED_COURSE = {
      ...SAMPLE_COURSE,
      currentLevel: 'B1',
      curriculum: { lessons: [SAMPLE_LESSON, SAMPLE_B1_LESSON] },
    };

    beforeEach(() => {
      mockCourseFindFirst.mockResolvedValue(SOURCED_COURSE);
      mockCourseClassFindFirst.mockResolvedValue(null);
      mockCourseClassFindMany.mockResolvedValue([]);
    });

    it('builds a sourced class from a URL: leveled to currentLevel, stores sourceUrl, threads sourceContent', async () => {
      mockPrepareClassSource.mockResolvedValue({
        leveledContent: 'Ein angepasster Artikeltext.',
        sourceMetadata: { title: 'Real Article', siteName: 'Example' },
        title: 'Real Article',
        sourceUrl: 'https://example.com/a',
      });

      const result = await createNextClass('course-1', 'u1', blockedProviderExecution('u1'), {
        sourceUrl: 'https://example.com/a',
      });

      expect(result.kind).toBe('created');
      // Source prepared at the LEARNER's current level, not the lesson level.
      expect(mockPrepareClassSource).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://example.com/a', level: 'B1', targetLang: 'es' })
      );
      // The class records what it was built from.
      expect(mockCourseClassCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceUrl: 'https://example.com/a',
            sourceTitle: 'Real Article',
          }),
        })
      );
      // The leveled passage is threaded into section generation.
      expect(mockGenerateSectionQuestions).toHaveBeenCalledWith(
        expect.objectContaining({ sourceContent: 'Ein angepasster Artikeltext.', level: 'B1' })
      );
      expect(mockGenerateClassIntro).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'B1', title: 'Opinions' })
      );
    });

    it('topic mode builds about the topic at currentLevel without extracting a URL', async () => {
      const result = await createNextClass('course-1', 'u1', blockedProviderExecution('u1'), {
        topic: 'Mars rovers',
      });

      expect(result.kind).toBe('created');
      expect(mockPrepareClassSource).not.toHaveBeenCalled();
      expect(mockCourseClassCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sourceTitle: 'Mars rovers', sourceUrl: null }),
        })
      );
      expect(mockGenerateSectionQuestions).toHaveBeenCalledWith(
        expect.objectContaining({ objective: 'Mars rovers', level: 'B1', sourceContent: undefined })
      );
    });

    it('starts normal classes at the course currentLevel instead of the first unpassed A1 lesson', async () => {
      const result = await createNextClass('course-1', 'u1', blockedProviderExecution('u1'));

      expect(result.kind).toBe('created');
      expect(mockCourseClassCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lessonId: 'lesson-b1',
            order: 15,
          }),
        })
      );
      expect(mockGenerateSectionQuestions).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'B1',
          objective: 'Discuss opinions with supporting reasons',
        })
      );
      expect(mockEnsureCurriculumHasLevelLessons).not.toHaveBeenCalled();
    });

    it('fails closed when the source cannot be read — no class is created', async () => {
      const { ClassSourceError } = await import('@/lib/class-source');
      mockPrepareClassSource.mockRejectedValue(new ClassSourceError('Could not read that link.'));

      await expect(
        createNextClass('course-1', 'u1', blockedProviderExecution('u1'), {
          sourceUrl: 'https://paywalled.com/x',
        })
      ).rejects.toBeInstanceOf(ClassSourceError);
      // Source prep happens BEFORE class creation, so nothing was persisted.
      expect(mockCourseClassCreate).not.toHaveBeenCalled();
    });
  });
});

// ---- submitClass ----
