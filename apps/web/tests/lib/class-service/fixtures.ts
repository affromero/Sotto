import { vi } from 'vitest';

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
const mockTransaction = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    course: {
      findFirst: (...args: unknown[]) => mockCourseFindFirst(...args),
      update: (...args: unknown[]) => mockCourseUpdate(...args),
    },
    courseClass: {
      findFirst: (...args: unknown[]) => mockCourseClassFindFirst(...args),
      findUnique: (...args: unknown[]) => mockCourseClassFindUnique(...args),
      findMany: (...args: unknown[]) => mockCourseClassFindMany(...args),
      create: (...args: unknown[]) => mockCourseClassCreate(...args),
      update: (...args: unknown[]) => mockCourseClassUpdate(...args),
      delete: (...args: unknown[]) => mockCourseClassDelete(...args),
    },
    classSection: {
      create: (...args: unknown[]) => mockClassSectionCreate(...args),
      update: (...args: unknown[]) => mockClassSectionUpdate(...args),
      deleteMany: (...args: unknown[]) => mockClassSectionDeleteMany(...args),
    },
    lessonQuestion: {
      create: (...args: unknown[]) => mockLessonQuestionCreate(...args),
      deleteMany: (...args: unknown[]) => mockLessonQuestionDeleteMany(...args),
    },
    speakingRecording: {
      deleteMany: (...args: unknown[]) => mockSpeakingRecordingDeleteMany(...args),
    },
    classSubmission: {
      upsert: (...args: unknown[]) => mockClassSubmissionUpsert(...args),
      deleteMany: (...args: unknown[]) => mockClassSubmissionDeleteMany(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

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
