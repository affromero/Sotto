import { learningScriptHash } from '@/lib/learning/script-hash';
import { createHash } from 'node:crypto';
import { createSkillRequirements, learningSkills } from '@sotto/shared';
import { expect, vi } from 'vitest';

const mockReadingProviderInput = vi.hoisted(() => vi.fn());

export { mockReadingProviderInput };
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: async () => ({ provider: 'anthropic', model: 'fixture' }),
  capturedLearningAiOptions: async () => ({}),
}));
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({
    generateResponse: async (
      system: string,
      messages: { content: string }[],
      options: { jsonSchema?: { name: string } }
    ) => {
      const input = JSON.parse(messages[0]!.content);
      if (input.passageText) {
        expect(system).toContain('JSON object containing only a words array');
        expect(options.jsonSchema?.name).toBe('reading_vocabulary_extraction');
        mockReadingProviderInput(input);
      } else expect(options.jsonSchema?.name).toBe('class_teaching_quality');
      return {
        content: JSON.stringify(
          options.jsonSchema?.name === 'class_teaching_quality'
            ? {
                items: input.items.map(({ index }: { index: number }) => ({
                  index,
                  acceptable: true,
                  issues: [],
                  feedback: [],
                })),
              }
            : {
                words: [
                  {
                    lemma: 'hola',
                    gloss: 'hello',
                    pos: 'expression',
                    sourceForm: 'Hola',
                    questionIndices: [],
                  },
                ],
              }
        ),
        model: 'fixture',
      };
    },
  }),
}));
vi.mock('@/lib/sidedoor/storage/core/storage-inputs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sidedoor/storage/core/storage-inputs')>()),
  resolveStorageInput: async () => ({
    input: { consumer: 'fixture', reference: '/reference.mp3' },
  }),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));

export const mockResolveSkillRequirements = vi.fn();
vi.mock('@/lib/learning/skill-requirements', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/learning/skill-requirements')>()),
  resolveSkillRequirements: (...args: unknown[]) => mockResolveSkillRequirements(...args),
}));

// ---- Hoisted mock handles ----

const mockCourseFindFirst = vi.fn();
const mockCourseClassFindFirst = vi.fn();
const mockCourseClassFindUnique = vi.fn();
const mockCourseClassFindMany = vi.fn();
const mockCourseClassCreate = vi.fn();
const mockCourseClassUpdate = vi.fn();
const mockCourseClassDelete = vi.fn();
const mockClassSectionCreate = vi.fn();
const mockClassSectionUpdate = vi.fn();
const mockClassSectionDeleteMany = vi.fn();
const mockLessonQuestionCreate = vi.fn();
const mockLessonQuestionDeleteMany = vi.fn();
const mockSpeakingRecordingDeleteMany = vi.fn();
const mockClassSubmissionUpsert = vi.fn();
const mockClassSubmissionDeleteMany = vi.fn();
const mockCourseUpdate = vi.fn();
const mockCourseUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const mockTransaction = vi.fn();

vi.mock('@/lib/prisma', () => {
  const database = {
    $queryRaw: async () => [],
    course: {
      findFirst: (...args: unknown[]) => mockCourseFindFirst(...args),
      update: (...args: unknown[]) => mockCourseUpdate(...args),
      updateMany: (...args: unknown[]) => mockCourseUpdateMany(...args),
    },
    courseClass: {
      findFirst: async (...args: unknown[]) => {
        const cls = await mockCourseClassFindFirst(...args);
        return cls ? { updatedAt: new Date('2026-09-30T00:00:00Z'), sections: [], ...cls } : null;
      },
      findUnique: (...args: unknown[]) => mockCourseClassFindUnique(...args),
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const created = mockCourseClassCreate.mock.calls.at(-1)?.[0]?.data;
        const updates = mockCourseClassUpdate.mock.calls.map(([input]) => input.data);
        const contract =
          updates.findLast((data) => data?.skillRequirements)?.skillRequirements ??
          created?.skillRequirements ??
          createSkillRequirements({
            scope: 'CLASS',
            nativeLang: 'en',
            targetLang: 'es',
            level: 'A1',
            ttsProvider: 'cartesia',
            sttProvider: 'openai',
          });
        const passageText = 'Hola, Ana.';
        return {
          id: where.id,
          course: { userId: 'u1' },
          courseId: created?.courseId ?? 'course-1',
          skillRequirements: contract,
          readingVocabulary: updates.findLast((data) => data?.readingVocabulary)
            ?.readingVocabulary ?? {
            passageText,
            sourceHash: createHash('sha256').update(passageText).digest('hex'),
            words: [
              {
                lemma: 'hola',
                gloss: 'hello',
                pos: 'expression',
                sourceForm: 'Hola',
                questionIds: [],
              },
            ],
          },
          sections: learningSkills
            .filter((skill) => contract.skills[skill].state === 'REQUIRED')
            .map((skill) => ({
              id: 'section-' + skill,
              skill,
              status: 'READY',
              attempt: 1,
              spec:
                skill === 'LISTENING'
                  ? { scriptHash: learningScriptHash([{ speaker: 'Ana', text: 'Hola.' }]) }
                  : {},
              questions: ['GRAMMAR', 'READING', 'LISTENING'].includes(skill)
                ? Array.from({ length: contract.skills[skill].expectedCount }, (_, index) => ({
                    id: skill === 'READING' && index === 0 ? 'reading-question' : skill + index,
                    skill,
                    question: 'Choose the greeting.',
                    options: ['Hola', 'Adiós', 'Ayer', 'Mañana'],
                    correctIndex: 0,
                    explanation: 'Hola greets people.',
                    passageText: skill === 'READING' ? passageText : null,
                  }))
                : [],
              prompts:
                skill === 'SPEAKING'
                  ? Array.from({ length: 4 }, (_, index) => ({
                      id: 's' + index,
                      targetPhrase: 'Hola',
                      translation: 'Hello',
                      referenceTtsUrl: contract.referenceAudioRequired ? '/reference.mp3' : null,
                    }))
                  : [],
              writingPrompts:
                skill === 'WRITING'
                  ? Array.from({ length: 3 }, (_, index) => ({
                      id: 'w' + index,
                      task: 'Greet Ana.',
                    }))
                  : [],
              episode:
                skill === 'LISTENING'
                  ? {
                      userId: 'u1',
                      status: 'PENDING',
                      audioUrl: null,
                      deletedAt: null,
                      script: { turns: [{ speaker: 'Ana', text: 'Hola.' }] },
                    }
                  : null,
            })),
        };
      },
      findMany: (...args: unknown[]) => mockCourseClassFindMany(...args),
      create: (...args: unknown[]) => mockCourseClassCreate(...args),
      update: (...args: unknown[]) => mockCourseClassUpdate(...args),
      updateMany: async (args: unknown) => {
        await mockCourseClassUpdate(args);
        return { count: 1 };
      },
      delete: (...args: unknown[]) => mockCourseClassDelete(...args),
    },
    classSection: {
      create: (...args: unknown[]) => mockClassSectionCreate(...args),
      update: (...args: unknown[]) => mockClassSectionUpdate(...args),
      deleteMany: (...args: unknown[]) => mockClassSectionDeleteMany(...args),
    },
    lessonQuestion: {
      findMany: async () => [
        {
          id: 'reading-question',
          question: 'What greeting is used?',
          options: ['Hola', 'Adiós', 'Ayer', 'Mañana'],
          correctIndex: 0,
          passageText: 'Hola, Ana.',
        },
      ],
      create: (...args: unknown[]) => mockLessonQuestionCreate(...args),
      deleteMany: (...args: unknown[]) => mockLessonQuestionDeleteMany(...args),
    },
    learnerVocab: { findMany: async () => [{ lemma: 'hola' }] },
    speakingRecording: {
      deleteMany: (...args: unknown[]) => mockSpeakingRecordingDeleteMany(...args),
    },
    classSubmission: {
      upsert: (...args: unknown[]) => mockClassSubmissionUpsert(...args),
      deleteMany: (...args: unknown[]) => mockClassSubmissionDeleteMany(...args),
    },
  };
  const client = {
    ...database,
    $transaction: (work: ((db: typeof database) => Promise<unknown>) | Promise<unknown>[]) =>
      typeof work === 'function' ? work(database) : mockTransaction(work),
  };
  return { prisma: client, prismaUnfiltered: client };
});

const mockGenerateSectionQuestions = vi.fn();
const mockGenerateClassIntro = vi.fn();
const mockGenerateClassListening = vi.fn();
const mockGenerateClassSpeaking = vi.fn();
const mockGenerateClassWriting = vi.fn();
const mockEnsureCurriculumHasLevelLessons = vi.fn();

vi.mock('@/lib/class-generation', () => ({
  generateSectionQuestions: (...args: unknown[]) => mockGenerateSectionQuestions(...args),
}));

vi.mock('@/lib/classes/class-intro', () => ({
  generateClassIntro: (...args: unknown[]) => mockGenerateClassIntro(...args),
}));

vi.mock('@/lib/curriculum-generator', () => ({
  ensureCurriculumHasLevelLessons: (...args: unknown[]) =>
    mockEnsureCurriculumHasLevelLessons(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/knowledge-graph', () => ({
  seedLessonItems: vi.fn(),
  getDueItems: vi.fn().mockResolvedValue({ vocab: [], grammar: [] }),
  applyReviewOutcome: vi.fn(),
}));

vi.mock('@/lib/class-listening-generator', () => ({
  generateClassListening: (...args: unknown[]) => mockGenerateClassListening(...args),
}));

vi.mock('@/lib/class-speaking-generator', () => ({
  generateClassSpeaking: (...args: unknown[]) => mockGenerateClassSpeaking(...args),
}));

vi.mock('@/lib/class-writing-generator', () => ({
  generateClassWriting: (...args: unknown[]) => mockGenerateClassWriting(...args),
}));

vi.mock('@/lib/course-notes', () => ({
  getCourseNote: vi.fn().mockResolvedValue(''),
}));

const mockPrepareClassSource = vi.fn();
vi.mock('@/lib/class-source', () => ({
  prepareClassSource: (...a: unknown[]) => mockPrepareClassSource(...a),
  ClassSourceError: class ClassSourceError extends Error {},
}));

// ---- Helpers ----

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

const SAMPLE_B1_LESSON = {
  id: 'lesson-b1',
  level: 'B1',
  order: 15,
  slug: 'opinions',
  objective: 'Discuss opinions with supporting reasons',
  grammarPoints: ['subordinate-clauses'],
  targetVocab: [{ lemma: 'meiner Meinung nach', gloss: 'in my opinion' }],
  title: 'Opinions',
};

const SAMPLE_COURSE = {
  id: 'course-1',
  userId: 'u1',
  curriculumId: 'curriculum-1',
  currentLevel: 'A1',
  nativeLang: 'en',
  targetLang: 'es',
  pedagogy: 'BALANCED',
  curriculum: {
    lessons: [SAMPLE_LESSON],
  },
};

const SAMPLE_QUESTIONS = [
  {
    question: 'Q1?',
    options: ['a', 'b', 'c', 'd'],
    correctIndex: 0,
    explanation: 'Exp1',
    passageRef: null,
  },
  {
    question: 'Q2?',
    options: ['a', 'b', 'c', 'd'],
    correctIndex: 1,
    explanation: 'Exp2',
    passageRef: null,
  },
  {
    question: 'Q3?',
    options: ['a', 'b', 'c', 'd'],
    correctIndex: 2,
    explanation: 'Exp3',
    passageRef: null,
  },
  {
    question: 'Q4?',
    options: ['a', 'b', 'c', 'd'],
    correctIndex: 0,
    explanation: 'Exp4',
    passageRef: null,
  },
  {
    question: 'Q5?',
    options: ['a', 'b', 'c', 'd'],
    correctIndex: 1,
    explanation: 'Exp5',
    passageRef: null,
  },
];

// ---- createNextClass ----

export {
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
  mockLessonQuestionDeleteMany,
  mockSpeakingRecordingDeleteMany,
  mockClassSubmissionUpsert,
  mockClassSubmissionDeleteMany,
  mockCourseUpdate,
  mockCourseUpdateMany,
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
};
