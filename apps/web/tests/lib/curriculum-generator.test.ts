/**
 * Unit tests for src/lib/curriculum-generator.ts
 *
 * All external dependencies are mocked. The tests verify:
 *  - Returns existing curriculum without calling the LLM
 *  - Generates + persists a new curriculum when none exists
 *  - Drops duplicate slugs before persisting
 *  - On a P2002 unique race, re-fetches and returns the winning curriculum
 *  - Throws when no AI key is configured
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock declarations (must be hoisted) ──────────────────────────────────────

const mockCurriculumFindUnique = vi.fn();
const mockCurriculumCreate = vi.fn();
const mockLessonCreateMany = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    curriculum: {
      findUnique: (...args: unknown[]) => mockCurriculumFindUnique(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

const mockGetAiKey = vi.fn();
vi.mock('@/lib/byok', () => ({
  getAiKey: (...args: unknown[]) => mockGetAiKey(...args),
}));

const mockGetAiProviderMeta = vi.fn();
vi.mock('@/lib/providers/ai-registry', () => ({
  getAiProviderMeta: (...args: unknown[]) => mockGetAiProviderMeta(...args),
}));

const mockGenerateResponse = vi.fn();
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({ generateResponse: mockGenerateResponse }),
}));

const mockLoadAndRender = vi.fn();
vi.mock('@/lib/prompt-loader', () => ({
  loadAndRender: (...args: unknown[]) => mockLoadAndRender(...args),
}));

const mockLogUsage = vi.fn();
vi.mock('@/lib/usage-logger', () => ({
  logUsage: (...args: unknown[]) => mockLogUsage(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Import under test (after mocks) ──────────────────────────────────────────
import { getOrCreateCurriculum } from '@/lib/curriculum-generator';

// ── Sample LLM curriculum JSON ────────────────────────────────────────────────

const VALID_CURRICULUM_JSON = JSON.stringify({
  title: 'German from English',
  lessons: [
    {
      slug: 'a1-greetings',
      level: 'A1',
      order: 1,
      title: 'Greetings',
      objective: 'Greet someone and introduce yourself.',
      grammarPoints: ['verb-sein'],
      vocabThemes: ['greetings'],
      targetVocab: [{ lemma: 'Hallo', gloss: 'Hello', pos: 'interjection' }],
      canDoSummary: 'I can greet someone.',
      estMinutes: 60,
    },
    {
      slug: 'a1-numbers',
      level: 'A1',
      order: 2,
      title: 'Numbers',
      objective: 'Count from 1 to 20.',
      grammarPoints: ['cardinal-numbers'],
      vocabThemes: ['numbers-1-20'],
      targetVocab: [{ lemma: 'eins', gloss: 'one' }],
      estMinutes: 60,
    },
  ],
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Wire up a successful transaction mock that calls the callback with a tx stub. */
function setupSuccessfulTransaction(createdId: string) {
  mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      curriculum: { create: mockCurriculumCreate },
      lesson: { createMany: mockLessonCreateMany },
    };
    mockCurriculumCreate.mockResolvedValue({ id: createdId });
    mockLessonCreateMany.mockResolvedValue({ count: 2 });
    return cb(tx);
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getOrCreateCurriculum', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAiKey.mockResolvedValue({ provider: 'anthropic', apiKey: 'sk-test' });
    mockGetAiProviderMeta.mockReturnValue({ defaultModel: 'claude-haiku-4-5-20251001' });
    mockLoadAndRender.mockReturnValue('You are a CEFR curriculum architect...');
    mockGenerateResponse.mockResolvedValue({
      content: VALID_CURRICULUM_JSON,
      inputTokens: 100,
      outputTokens: 500,
      model: 'claude-haiku-4-5-20251001',
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ── Happy-path: curriculum already exists ──────────────────────────────────

  it('returns the existing curriculum without calling the LLM when one is found', async () => {
    mockCurriculumFindUnique.mockResolvedValue({ id: 'existing-id' });

    const result = await getOrCreateCurriculum('user-1', 'en', 'de');

    expect(result).toEqual({ id: 'existing-id' });
    expect(mockGetAiKey).not.toHaveBeenCalled();
    expect(mockGenerateResponse).not.toHaveBeenCalled();
  });

  it('queries by the nativeLang_targetLang composite when checking existence', async () => {
    mockCurriculumFindUnique.mockResolvedValue({ id: 'existing-id' });

    await getOrCreateCurriculum('user-1', 'en', 'de');

    expect(mockCurriculumFindUnique).toHaveBeenCalledWith({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
      select: { id: true },
    });
  });

  // ── Happy-path: generate + persist ────────────────────────────────────────

  it('generates a new curriculum and persists it when none exists', async () => {
    mockCurriculumFindUnique.mockResolvedValue(null);
    setupSuccessfulTransaction('new-id');

    const result = await getOrCreateCurriculum('user-1', 'en', 'de');

    expect(result).toEqual({ id: 'new-id' });
    expect(mockGenerateResponse).toHaveBeenCalledOnce();
    expect(mockCurriculumCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: 'generated', nativeLang: 'en', targetLang: 'de' }),
      })
    );
    expect(mockLessonCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ slug: 'a1-greetings', level: 'A1', order: 1 }),
          expect.objectContaining({ slug: 'a1-numbers', level: 'A1', order: 2 }),
        ]),
      })
    );
  });

  it('passes NATIVE and TARGET placeholders to the prompt loader', async () => {
    mockCurriculumFindUnique.mockResolvedValue(null);
    setupSuccessfulTransaction('new-id');

    await getOrCreateCurriculum('user-1', 'en', 'de');

    expect(mockLoadAndRender).toHaveBeenCalledWith('curriculum/generate-curriculum.md', {
      NATIVE: expect.any(String),
      TARGET: expect.any(String),
    });
  });

  it('logs AI usage after generation', async () => {
    mockCurriculumFindUnique.mockResolvedValue(null);
    setupSuccessfulTransaction('new-id');

    await getOrCreateCurriculum('user-1', 'en', 'de');

    expect(mockLogUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'anthropic',
        category: 'curriculum-generation',
        userId: 'user-1',
      })
    );
  });

  // ── Slug deduplication ─────────────────────────────────────────────────────

  it('drops duplicate-slug lessons before persisting', async () => {
    mockCurriculumFindUnique.mockResolvedValue(null);

    const jsonWithDupe = JSON.stringify({
      title: 'German from English',
      lessons: [
        {
          slug: 'a1-greetings',
          level: 'A1',
          order: 1,
          title: 'Greetings',
          objective: 'Greet someone.',
          grammarPoints: ['verb-sein'],
          vocabThemes: ['greetings'],
          targetVocab: [{ lemma: 'Hallo', gloss: 'Hello' }],
          estMinutes: 60,
        },
        {
          slug: 'a1-greetings', // duplicate
          level: 'A1',
          order: 2,
          title: 'Greetings Again',
          objective: 'Say hi again.',
          grammarPoints: ['verb-sein'],
          vocabThemes: ['greetings'],
          targetVocab: [{ lemma: 'Tschüss', gloss: 'Bye' }],
          estMinutes: 60,
        },
        {
          slug: 'a1-numbers',
          level: 'A1',
          order: 3,
          title: 'Numbers',
          objective: 'Count to 10.',
          grammarPoints: ['cardinal-numbers'],
          vocabThemes: ['numbers'],
          targetVocab: [{ lemma: 'eins', gloss: 'one' }],
          estMinutes: 60,
        },
      ],
    });
    mockGenerateResponse.mockResolvedValue({
      content: jsonWithDupe,
      inputTokens: 100,
      outputTokens: 500,
      model: 'claude-haiku-4-5-20251001',
    });

    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        curriculum: { create: mockCurriculumCreate },
        lesson: { createMany: mockLessonCreateMany },
      };
      mockCurriculumCreate.mockResolvedValue({ id: 'dedup-id' });
      mockLessonCreateMany.mockResolvedValue({ count: 2 });
      return cb(tx);
    });

    await getOrCreateCurriculum('user-1', 'en', 'de');

    const createManyCall = mockLessonCreateMany.mock.calls[0][0];
    // Only 2 lessons should be persisted (duplicate removed)
    expect(createManyCall.data).toHaveLength(2);
    const slugs = createManyCall.data.map((l: { slug: string }) => l.slug);
    expect(slugs).toEqual(['a1-greetings', 'a1-numbers']);
  });

  // ── P2002 race condition ───────────────────────────────────────────────────

  it('re-fetches and returns the winning curriculum on a P2002 concurrent creation race', async () => {
    mockCurriculumFindUnique
      .mockResolvedValueOnce(null) // initial check → miss
      .mockResolvedValueOnce({ id: 'winner-id' }); // re-fetch after race

    // Make the thrown error behave like a PrismaClientKnownRequestError for the instanceof check
    const { Prisma } = await import('@/generated/prisma/client');
    const prismaError = Object.create(Prisma.PrismaClientKnownRequestError.prototype);
    Object.assign(prismaError, {
      message: 'Unique constraint failed',
      code: 'P2002',
      clientVersion: '5.0.0',
    });
    mockTransaction.mockRejectedValue(prismaError);

    const result = await getOrCreateCurriculum('user-1', 'en', 'de');

    expect(result).toEqual({ id: 'winner-id' });
    expect(mockCurriculumFindUnique).toHaveBeenCalledTimes(2);
  });

  // ── No AI provider available ─────────────────────────────────────────────────

  it('throws when there is no BYOK key and no local agent configured', async () => {
    mockCurriculumFindUnique.mockResolvedValue(null);
    mockGetAiKey.mockResolvedValue(null);
    vi.stubEnv('AI_PROVIDER', '');

    await expect(getOrCreateCurriculum('user-no-key', 'en', 'de')).rejects.toThrow(/AI provider/i);
    expect(mockGenerateResponse).not.toHaveBeenCalled();
  });

  // ── Keyless local-agent path ─────────────────────────────────────────────────

  it('generates via the keyless local agent when no BYOK key but AI_PROVIDER=claude-code', async () => {
    mockCurriculumFindUnique.mockResolvedValue(null);
    mockGetAiKey.mockResolvedValue(null);
    vi.stubEnv('AI_PROVIDER', 'claude-code');
    mockGetAiProviderMeta.mockReturnValue({ defaultModel: 'claude-sonnet-4-6' });
    setupSuccessfulTransaction('agent-built');

    const result = await getOrCreateCurriculum('user-agent', 'en', 'de');

    expect(result).toEqual({ id: 'agent-built' });
    expect(mockGenerateResponse).toHaveBeenCalled();
    // Keyless path: no apiKey override is forwarded to the provider.
    expect(mockGenerateResponse.mock.calls[0][2]).toMatchObject({ apiKeyOverride: undefined });
  });
});
