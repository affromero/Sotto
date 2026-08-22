import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSessionFindFirst = vi.fn();
const mockSpeakingFindMany = vi.fn();
const mockWritingFindMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    practiceSession: { findFirst: (...a: unknown[]) => mockSessionFindFirst(...a) },
    speakingPrompt: { findMany: (...a: unknown[]) => mockSpeakingFindMany(...a) },
    writingPrompt: { findMany: (...a: unknown[]) => mockWritingFindMany(...a) },
  },
}));

import { resumePractice } from '@/lib/practice/resume';
import { PracticeSessionNotFoundError } from '@/lib/practice-service';

const ITEMS = [
  {
    id: 'g0',
    prompt: 'Was hast du gestern gemacht?',
    options: ['a', 'b', 'c', 'd'],
    correctIndex: 0,
    explanation: 'because',
    vocabLemma: null,
    focusTargetId: null,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockSpeakingFindMany.mockResolvedValue([]);
  mockWritingFindMany.mockResolvedValue([]);
});

describe('resumePractice', () => {
  it('returns the questions without the answer key', async () => {
    mockSessionFindFirst.mockResolvedValue({
      id: 'sess-1',
      kind: 'GRAMMAR',
      status: 'ACTIVE',
      items: ITEMS,
      episodeId: null,
    });

    const result = await resumePractice('sess-1', 'user-1');

    expect(result).toEqual({
      status: 'ready',
      sessionId: 'sess-1',
      kind: 'GRAMMAR',
      items: [{ id: 'g0', prompt: 'Was hast du gestern gemacht?', options: ['a', 'b', 'c', 'd'] }],
      episodeId: undefined,
    });
    expect(JSON.stringify(result)).not.toContain('correctIndex');
  });

  it('returns speaking and writing prompts alongside the questions for a full session', async () => {
    mockSessionFindFirst.mockResolvedValue({
      id: 'sess-2',
      kind: 'FULL',
      status: 'ACTIVE',
      items: ITEMS,
      episodeId: 'ep-1',
    });
    mockSpeakingFindMany.mockResolvedValue([
      { id: 'sp-1', targetPhrase: 'Guten Tag', translation: 'Good day', referenceTtsUrl: null },
    ]);
    mockWritingFindMany.mockResolvedValue([
      { id: 'wr-1', task: 'Antworte deiner Freundin', guidance: null, ideas: ['Gestern habe ich'] },
    ]);

    const result = await resumePractice('sess-2', 'user-1');

    expect(result).toMatchObject({
      status: 'ready_full',
      sessionId: 'sess-2',
      episodeId: 'ep-1',
      speakingPrompts: [expect.objectContaining({ id: 'sp-1' })],
      writingPrompts: [expect.objectContaining({ id: 'wr-1', ideas: ['Gestern habe ich'] })],
    });
  });

  it('refuses a session belonging to someone else', async () => {
    mockSessionFindFirst.mockResolvedValue(null);

    await expect(resumePractice('sess-1', 'other-user')).rejects.toBeInstanceOf(
      PracticeSessionNotFoundError
    );
    expect(mockSessionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sess-1', course: { userId: 'other-user' } },
      })
    );
  });

  it('refuses a session that was already graded', async () => {
    mockSessionFindFirst.mockResolvedValue({
      id: 'sess-3',
      kind: 'GRAMMAR',
      status: 'COMPLETED',
      items: ITEMS,
      episodeId: null,
    });

    await expect(resumePractice('sess-3', 'user-1')).rejects.toBeInstanceOf(
      PracticeSessionNotFoundError
    );
  });
});
