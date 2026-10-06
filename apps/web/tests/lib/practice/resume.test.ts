import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { createSkillRequirements } from '@sotto/shared';

const mockSessionFindFirst = vi.fn();
const mockSpeakingFindMany = vi.fn();
const mockWritingFindMany = vi.fn();
const mockPreparationFindFirst = vi.fn();
const mockPreparationFindUnique = vi.fn();
const mockCourseFindUnique = vi.fn();
const mockStateQuery = vi.fn();

vi.mock('@/lib/prisma', () => {
  const database = {
    practiceSession: { findFirst: (...a: unknown[]) => mockSessionFindFirst(...a) },
    speakingPrompt: { findMany: (...a: unknown[]) => mockSpeakingFindMany(...a) },
    writingPrompt: { findMany: (...a: unknown[]) => mockWritingFindMany(...a) },
    $transaction: async (operation: (transaction: unknown) => Promise<unknown>) =>
      operation({
        practiceSession: {
          findFirst: (...a: unknown[]) => mockPreparationFindFirst(...a),
          findUnique: (...a: unknown[]) => mockPreparationFindUnique(...a),
        },
        course: { findUnique: (...a: unknown[]) => mockCourseFindUnique(...a) },
        $queryRaw: async () => [],
        $queryRawUnsafe: (...a: unknown[]) => mockStateQuery(...a),
      }),
  };
  return { prisma: database, prismaUnfiltered: database };
});

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
  function completedDuringRead(priorStatus: 'RUNNING' | 'CANCELLING' = 'RUNNING') {
    const sessionId = '9b8dbe9c-4caa-4432-af65-1f842c5dbca5';
    const instanceId = '339fd159-2637-41c6-bfba-bbed11f0e78b';
    const requirements = createSkillRequirements({
      scope: 'FULL',
      nativeLang: 'en',
      targetLang: 'de',
      level: 'A2',
      ttsProvider: 'cartesia',
      sttProvider: 'cartesia',
    });
    const generation = {
      course: {
        id: 'course',
        userId: 'user',
        nativeLang: 'en',
        targetLang: 'de',
        currentLevel: 'A2',
        curriculumId: 'curriculum',
        pedagogy: 'BALANCED',
      },
      requirements,
      seedToken: 'seed',
      note: '',
      focusTargets: [],
      seed: null,
    };
    const completed = {
      id: '092ae0aa-194d-4231-acf5-49d6c9c7b66c',
      sessionId,
      courseId: 'course',
      userId: 'user',
      courseCreatedAt: 1000,
      userCreatedAt: 2000,
      instanceId,
      createdAt: 3000,
      availableAt: 3000,
      expiresAt: 9000,
      maxProviderRequests: 256,
      selection: { provider: 'local', model: 'fixture', credentialFingerprint: null },
      grant: {
        id: '092ae0aa-194d-4231-acf5-49d6c9c7b66c',
        revision: '69702bf9-3d91-4945-ac94-6db805e7e8cb',
        fingerprint: 'a'.repeat(64),
      },
      inputFingerprint: createHash('sha256').update(JSON.stringify(generation)).digest('hex'),
      status: 'COMPLETED',
      audioEpisodeIds: [],
      updatedAt: 4000,
      failure: null,
      unavailableReason: null,
      speechFingerprint: 'b'.repeat(64),
      focusTargetId: null,
    };
    const published = {
      id: sessionId,
      kind: 'FULL',
      status: 'ACTIVE',
      items: ITEMS,
      episodeId: 'published-audio',
      skillRequirements: requirements,
      generationSpec: generation,
      generationState: completed,
    };
    mockSessionFindFirst.mockResolvedValueOnce({
      ...published,
      status: 'GENERATING',
      items: [],
      episodeId: null,
      generationState: { ...completed, status: priorStatus },
    });
    mockPreparationFindFirst.mockResolvedValue({ id: sessionId });
    mockPreparationFindUnique.mockResolvedValue(published);
    mockCourseFindUnique.mockResolvedValue({
      id: 'course',
      createdAt: new Date(1000),
      user: { id: 'user', createdAt: new Date(2000) },
    });
    mockStateQuery.mockImplementation((sql: string, key: string) => {
      if (sql !== 'SELECT "revision", "state" FROM "SidedoorState" WHERE "id" = $1')
        throw new Error('Unexpected database mutation or query');
      if (key.startsWith('sd-t:1:')) return [];
      const kind = key.startsWith('sd-i:1:')
        ? 'storage_instance'
        : key.startsWith('sd-ia:1:')
          ? 'storage_instance_allocation'
          : null;
      if (!kind) throw new Error('Unexpected database state read');
      return [
        {
          revision: '69702bf9-3d91-4945-ac94-6db805e7e8cb',
          state: {
            schemaVersion: 1,
            kind,
            namespace: 'sotto-platform-v2',
            instanceId,
          },
        },
      ];
    });
    return { sessionId, published };
  }

  it.each(['RUNNING', 'CANCELLING'] as const)(
    'restores newly published exercises when %s preparation completes during the read',
    async (priorStatus) => {
      const { sessionId, published } = completedDuringRead(priorStatus);
      mockSessionFindFirst.mockResolvedValueOnce(published);
      const result = await resumePractice(sessionId, 'user');
      expect(result).toMatchObject({
        status: 'ready_full',
        sessionId,
        episodeId: 'published-audio',
        items: [{ prompt: ITEMS[0].prompt }],
      });
      expect(JSON.stringify(result)).not.toContain('correctIndex');
    }
  );

  it('refuses a practice removed or reassigned before its completed material is read', async () => {
    const { sessionId } = completedDuringRead();
    mockSessionFindFirst.mockResolvedValueOnce(null);
    await expect(resumePractice(sessionId, 'user')).rejects.toBeInstanceOf(
      PracticeSessionNotFoundError
    );
  });

  it.each(['id', 'sessionId', 'userId', 'inputFingerprint', 'status'] as const)(
    'refuses completed material whose preparation %s changed during the read',
    async (field) => {
      const { sessionId, published } = completedDuringRead();
      const changed = {
        ...published.generationState,
        [field]:
          field === 'inputFingerprint'
            ? 'c'.repeat(64)
            : field === 'status'
              ? 'RUNNING'
              : field === 'userId'
                ? 'other-user'
                : '5988a162-7e31-4c50-81ad-4b7a421f2d69',
      };
      mockSessionFindFirst.mockResolvedValueOnce({ ...published, generationState: changed });
      await expect(resumePractice(sessionId, 'user')).rejects.toThrow(
        'Practice preparation changed'
      );
    }
  );

  it('restores the reading source without revealing its answer', async () => {
    mockSessionFindFirst.mockResolvedValue({
      id: 'reading',
      kind: 'READING',
      status: 'ACTIVE',
      items: [{ ...ITEMS[0], passageText: 'Mia fährt am Samstag nach Berlin.' }],
      episodeId: null,
    });
    const result = await resumePractice('reading', 'user-1');
    expect(result).toMatchObject({ items: [{ passageText: 'Mia fährt am Samstag nach Berlin.' }] });
    expect(JSON.stringify(result)).not.toContain('correctIndex');
  });
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
      {
        id: 'sp-1',
        targetPhrase: 'Guten Tag',
        translation: 'Good day',
        referenceTtsUrl: null,
        recordings: [],
      },
    ]);
    mockWritingFindMany.mockResolvedValue([
      {
        id: 'wr-1',
        task: 'Antworte deiner Freundin',
        guidance: null,
        ideas: ['Gestern habe ich'],
        responses: [],
      },
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
    await expect(resumePractice('sess-1', 'other-user')).rejects.toThrow(
      'Practice session not found'
    );
    expect(mockSessionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sess-1', course: { userId: 'other-user' } },
      })
    );
  });

  it('restores the latest pending recording and writing feedback without paid generation', async () => {
    mockSessionFindFirst.mockResolvedValue({
      id: 'full',
      kind: 'FULL',
      status: 'ACTIVE',
      items: ITEMS,
      progressRevision: 3,
      learnerAnswers: { g0: 1 },
      writingDrafts: { w: 'Edited greeting.' },
    });
    mockSpeakingFindMany.mockResolvedValue([
      {
        id: 's',
        targetPhrase: 'Hola',
        translation: 'Hello',
        referenceTtsUrl: null,
        recordings: [
          {
            id: 'new',
            status: 'PENDING',
            overallScore: null,
            transcript: null,
            rubricScores: null,
            feedback: null,
          },
        ],
      },
    ]);
    mockWritingFindMany.mockResolvedValue([
      {
        id: 'w',
        task: 'Greet someone',
        guidance: null,
        ideas: [],
        responses: [
          { text: 'Hola.', overallScore: 0.8, corrections: [], feedback: 'Clear greeting.' },
        ],
      },
    ]);
    const result = await resumePractice('full', 'user');
    expect(result).toMatchObject({
      progressRevision: 3,
      learnerAnswers: { g0: 1 },
      writingDrafts: { w: 'Edited greeting.' },
      speakingPrompts: [
        { latestRecording: { recordingId: 'new', status: 'PENDING', overallScore: null } },
      ],
      writingPrompts: [
        { response: { text: 'Hola.', feedback: 'Clear greeting.', overallScore: 0.8 } },
      ],
    });
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
