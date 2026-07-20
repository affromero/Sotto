/**
 * createMockExam builds a full exam from the flagship blueprint by calling the
 * class generator cores per section and persisting into the exam models. Section
 * generation is best-effort: a failing core marks that section FAILED but the
 * exam still finishes READY when other sections succeed. The real exam-blueprint
 * is used (pure), so a German course exercises the four-section Goethe format.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCourseFindFirst = vi.fn();
const mockExamCreate = vi.fn();
const mockExamUpdate = vi.fn();
const mockSectionCreate = vi.fn();
const mockSectionUpdate = vi.fn();
const mockQuestionCreateMany = vi.fn();
const mockSpeakingCreateMany = vi.fn();
const mockWritingCreateMany = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    course: { findFirst: (...a: unknown[]) => mockCourseFindFirst(...a) },
    mockExam: {
      create: (...a: unknown[]) => mockExamCreate(...a),
      update: (...a: unknown[]) => mockExamUpdate(...a),
    },
    examSection: {
      create: (...a: unknown[]) => mockSectionCreate(...a),
      update: (...a: unknown[]) => mockSectionUpdate(...a),
    },
    examQuestion: { createMany: (...a: unknown[]) => mockQuestionCreateMany(...a) },
    speakingPrompt: { createMany: (...a: unknown[]) => mockSpeakingCreateMany(...a) },
    writingPrompt: { createMany: (...a: unknown[]) => mockWritingCreateMany(...a) },
  },
}));

const mockResolveExamSpec = vi.fn();
vi.mock('@/lib/exam-spec', () => ({
  resolveExamSpec: (...a: unknown[]) => mockResolveExamSpec(...a),
}));

const mockGenQuestions = vi.fn();
vi.mock('@/lib/class-generation', () => ({
  generateSectionQuestions: (...a: unknown[]) => mockGenQuestions(...a),
}));
const mockListening = vi.fn();
vi.mock('@/lib/class-listening-generator', () => ({
  composeListeningContent: (...a: unknown[]) => mockListening(...a),
}));
const mockSpeaking = vi.fn();
vi.mock('@/lib/class-speaking-generator', () => ({
  composeSpeakingPrompts: (...a: unknown[]) => mockSpeaking(...a),
}));
const mockWriting = vi.fn();
vi.mock('@/lib/class-writing-generator', () => ({
  composeWritingPrompts: (...a: unknown[]) => mockWriting(...a),
}));
vi.mock('@/lib/course-notes', () => ({ getCourseNote: vi.fn(async () => '') }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { createMockExam, ExamCourseNotFoundError } from '@/lib/mock-exam-service';

const GERMAN_COURSE = {
  id: 'c1',
  userId: 'u1',
  nativeLang: 'en',
  targetLang: 'de',
  curriculumId: 'cur1',
  currentLevel: 'B1',
};

function lastStatus(): string | undefined {
  const calls = mockExamUpdate.mock.calls;
  return calls.length
    ? (calls[calls.length - 1][0] as { data: { status: string } }).data.status
    : undefined;
}

describe('createMockExam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCourseFindFirst.mockResolvedValue(GERMAN_COURSE);
    mockExamCreate.mockResolvedValue({ id: 'exam1', institution: 'GOETHE', level: 'B1' });
    let sec = 0;
    mockSectionCreate.mockImplementation(async () => ({ id: `sec-${++sec}` }));
    mockSectionUpdate.mockResolvedValue({});
    mockExamUpdate.mockResolvedValue({});
    mockQuestionCreateMany.mockResolvedValue({ count: 1 });
    mockSpeakingCreateMany.mockResolvedValue({ count: 1 });
    mockWritingCreateMany.mockResolvedValue({ count: 1 });
    mockResolveExamSpec.mockResolvedValue({
      objective: 'Show B1',
      grammarPoints: ['akkusativ'],
      targetVocab: [{ lemma: 'der Kaffee', gloss: 'coffee' }],
    });
    mockGenQuestions.mockResolvedValue([
      { question: 'Q', options: ['a', 'b'], correctIndex: 0, explanation: 'because' },
    ]);
    mockListening.mockResolvedValue({
      episodeId: 'pod1',
      comprehensionQuestions: [
        { question: 'L', options: ['a', 'b'], correctIndex: 1, explanation: 'why' },
      ],
    });
    mockSpeaking.mockResolvedValue([
      { targetPhrase: 'Hallo', translation: 'Hello', ipa: null, referenceTtsUrl: null },
    ]);
    mockWriting.mockResolvedValue([{ task: 'Write a note', guidance: null }]);
  });

  it('throws when the course is not owned by the caller', async () => {
    mockCourseFindFirst.mockResolvedValue(null);
    await expect(createMockExam('c1', 'u1')).rejects.toBeInstanceOf(ExamCourseNotFoundError);
    expect(mockExamCreate).not.toHaveBeenCalled();
  });

  it('builds the four Goethe sections and finishes READY', async () => {
    const examId = await createMockExam('c1', 'u1');
    expect(examId).toBe('exam1');
    // Goethe blueprint: reading (mc), listening, writing, speaking.
    expect(mockSectionCreate).toHaveBeenCalledTimes(4);
    expect(mockGenQuestions).toHaveBeenCalledTimes(1); // reading mc
    expect(mockListening).toHaveBeenCalledTimes(1);
    expect(mockSpeaking).toHaveBeenCalledTimes(1);
    expect(mockWriting).toHaveBeenCalledTimes(1);
    expect(lastStatus()).toBe('READY');
  });

  it('keys speaking/writing prompts to the exam section (reused models)', async () => {
    await createMockExam('c1', 'u1');
    const speakingData = mockSpeakingCreateMany.mock.calls[0][0].data;
    expect(speakingData[0].examSectionId).toMatch(/^sec-/);
    const writingData = mockWritingCreateMany.mock.calls[0][0].data;
    expect(writingData[0].examSectionId).toMatch(/^sec-/);
  });

  it('marks a failed section but still finishes READY when others succeed', async () => {
    mockSpeaking.mockRejectedValue(new Error('no TTS key'));
    const examId = await createMockExam('c1', 'u1');
    expect(examId).toBe('exam1');
    const sectionStatuses = mockSectionUpdate.mock.calls.map(
      (c) => (c[0] as { data: { status: string } }).data.status
    );
    expect(sectionStatuses).toContain('FAILED');
    expect(lastStatus()).toBe('READY');
  });
});
