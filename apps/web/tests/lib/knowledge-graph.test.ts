import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Hoisted mock handles ----

const mockLearnerVocabUpsert = vi.fn();
const mockLearnerVocabFindMany = vi.fn();
const mockLearnerVocabUpdate = vi.fn();
const mockLearnerGrammarUpsert = vi.fn();
const mockLearnerGrammarFindMany = vi.fn();
const mockLearnerGrammarUpdate = vi.fn();
const mockVocabEdgeFindMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    learnerVocab: {
      upsert: (...args: unknown[]) => mockLearnerVocabUpsert(...args),
      findMany: (...args: unknown[]) => mockLearnerVocabFindMany(...args),
      update: (...args: unknown[]) => mockLearnerVocabUpdate(...args),
    },
    learnerGrammar: {
      upsert: (...args: unknown[]) => mockLearnerGrammarUpsert(...args),
      findMany: (...args: unknown[]) => mockLearnerGrammarFindMany(...args),
      update: (...args: unknown[]) => mockLearnerGrammarUpdate(...args),
    },
    vocabEdge: {
      findMany: (...args: unknown[]) => mockVocabEdgeFindMany(...args),
    },
  },
}));

// Real srs.ts is used intentionally (pure function, no deps)

// ---- Imports under test ----

import {
  seedLessonItems,
  applyReviewOutcome,
  getDueItems,
  getMemoryGraph,
} from '@/lib/knowledge-graph';

// ---- Helpers ----

const NOW = new Date('2026-06-08T00:00:00.000Z');

const FRESH_SRS = {
  ease: 2.5,
  intervalDays: 0,
  reps: 0,
  lapses: 0,
  mastery: 0.1,
};

function makeFreshVocabRow(overrides: Partial<typeof FRESH_SRS & { id: string; lemma: string; translation: string }> = {}) {
  return {
    id: 'v1',
    lemma: 'hola',
    translation: 'hello',
    ...FRESH_SRS,
    ...overrides,
  };
}

function makeFreshGrammarRow(overrides: Partial<typeof FRESH_SRS & { id: string; topicKey: string; title: string }> = {}) {
  return {
    id: 'g1',
    topicKey: 'articles',
    title: 'Articles',
    ...FRESH_SRS,
    ...overrides,
  };
}

// ---- seedLessonItems ----

describe('seedLessonItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLearnerVocabUpsert.mockResolvedValue({});
    mockLearnerGrammarUpsert.mockResolvedValue({});
  });

  it('calls learnerVocab.upsert once per vocab item', async () => {
    await seedLessonItems(
      'course-1',
      'class-1',
      'A1',
      [
        { lemma: 'hola', gloss: 'hello', pos: 'interjection' },
        { lemma: 'gracias', gloss: 'thank you' },
      ],
      [],
    );

    expect(mockLearnerVocabUpsert).toHaveBeenCalledTimes(2);
    expect(mockLearnerVocabUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { courseId_lemma: { courseId: 'course-1', lemma: 'hola' } },
        create: expect.objectContaining({ courseId: 'course-1', lemma: 'hola', translation: 'hello' }),
      }),
    );
  });

  it('calls learnerGrammar.upsert once per grammar point', async () => {
    await seedLessonItems('course-1', 'class-1', 'A1', [], ['articles', 'ser-vs-estar']);

    expect(mockLearnerGrammarUpsert).toHaveBeenCalledTimes(2);
    expect(mockLearnerGrammarUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { courseId_topicKey: { courseId: 'course-1', topicKey: 'articles' } },
        create: expect.objectContaining({ courseId: 'course-1', topicKey: 'articles' }),
      }),
    );
  });

  it('skips vocab items with an empty lemma', async () => {
    await seedLessonItems(
      'course-1',
      'class-1',
      'A1',
      [
        { lemma: '', gloss: 'should be skipped' },
        { lemma: 'bueno', gloss: 'good' },
      ],
      [],
    );

    expect(mockLearnerVocabUpsert).toHaveBeenCalledTimes(1);
    expect(mockLearnerVocabUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ lemma: 'bueno' }),
      }),
    );
  });

  it('skips grammar points with an empty key', async () => {
    await seedLessonItems('course-1', 'class-1', 'A1', [], ['', 'subjunctive']);

    expect(mockLearnerGrammarUpsert).toHaveBeenCalledTimes(1);
    expect(mockLearnerGrammarUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ topicKey: 'subjunctive' }),
      }),
    );
  });

  it('does nothing when both vocab and grammarPoints are empty', async () => {
    await seedLessonItems('course-1', 'class-1', 'A1', [], []);

    expect(mockLearnerVocabUpsert).not.toHaveBeenCalled();
    expect(mockLearnerGrammarUpsert).not.toHaveBeenCalled();
  });
});

// ---- applyReviewOutcome ----

describe('applyReviewOutcome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLearnerVocabUpdate.mockResolvedValue({});
    mockLearnerGrammarUpdate.mockResolvedValue({});
    mockLearnerGrammarFindMany.mockResolvedValue([]);
  });

  it('calls learnerVocab.update with raised mastery for a passing quality (>=0.6)', async () => {
    const initialMastery = 0.1;
    mockLearnerVocabFindMany.mockResolvedValue([makeFreshVocabRow({ mastery: initialMastery })]);

    await applyReviewOutcome('course-1', ['hola'], [], 0.8, 0.8, NOW);

    expect(mockLearnerVocabUpdate).toHaveBeenCalledTimes(1);
    const callData = mockLearnerVocabUpdate.mock.calls[0][0];
    expect(callData.where).toEqual({ id: 'v1' });
    // reviewCard with quality=0.8 (pass) must raise mastery above initial
    expect(callData.data.mastery).toBeGreaterThan(initialMastery);
    expect(callData.data.lastReviewed).toBe(NOW);
  });

  it('calls learnerVocab.update with lowered mastery for a failing quality (<0.6)', async () => {
    const initialMastery = 0.4;
    mockLearnerVocabFindMany.mockResolvedValue([makeFreshVocabRow({ mastery: initialMastery })]);

    await applyReviewOutcome('course-1', ['hola'], [], 0.2, 0.2, NOW);

    expect(mockLearnerVocabUpdate).toHaveBeenCalledTimes(1);
    const callData = mockLearnerVocabUpdate.mock.calls[0][0];
    // reviewCard with quality=0.2 (fail) halves mastery
    expect(callData.data.mastery).toBeLessThan(initialMastery);
  });

  it('calls learnerGrammar.update with raised mastery for a passing quality', async () => {
    const initialMastery = 0.15;
    mockLearnerVocabFindMany.mockResolvedValue([]);
    mockLearnerGrammarFindMany.mockResolvedValue([makeFreshGrammarRow({ mastery: initialMastery })]);

    await applyReviewOutcome('course-1', [], ['articles'], 1.0, 1.0, NOW);

    expect(mockLearnerGrammarUpdate).toHaveBeenCalledTimes(1);
    const callData = mockLearnerGrammarUpdate.mock.calls[0][0];
    expect(callData.where).toEqual({ id: 'g1' });
    expect(callData.data.mastery).toBeGreaterThan(initialMastery);
  });

  it('calls learnerGrammar.update with lowered mastery for a failing quality', async () => {
    const initialMastery = 0.5;
    mockLearnerVocabFindMany.mockResolvedValue([]);
    mockLearnerGrammarFindMany.mockResolvedValue([makeFreshGrammarRow({ mastery: initialMastery })]);

    await applyReviewOutcome('course-1', [], ['articles'], 0.0, 0.0, NOW);

    expect(mockLearnerGrammarUpdate).toHaveBeenCalledTimes(1);
    const callData = mockLearnerGrammarUpdate.mock.calls[0][0];
    expect(callData.data.mastery).toBeLessThan(initialMastery);
  });

  it('does not call update when findMany returns no matching cards', async () => {
    mockLearnerVocabFindMany.mockResolvedValue([]);
    mockLearnerGrammarFindMany.mockResolvedValue([]);

    await applyReviewOutcome('course-1', ['hola'], ['articles'], 1.0, 1.0, NOW);

    expect(mockLearnerVocabUpdate).not.toHaveBeenCalled();
    expect(mockLearnerGrammarUpdate).not.toHaveBeenCalled();
  });
});

// ---- getDueItems ----

describe('getDueItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns { vocab, grammar } shaped results from findMany', async () => {
    const vocabRow = { id: 'v1', lemma: 'hola', translation: 'hello', mastery: 0.3 };
    const grammarRow = { id: 'g1', topicKey: 'articles', title: 'Articles', mastery: 0.2 };

    mockLearnerVocabFindMany.mockResolvedValue([vocabRow]);
    mockLearnerGrammarFindMany.mockResolvedValue([grammarRow]);

    const result = await getDueItems('course-1');

    expect(result.vocab).toHaveLength(1);
    expect(result.vocab[0]).toMatchObject({ id: 'v1', lemma: 'hola', translation: 'hello', mastery: 0.3 });
    expect(result.grammar).toHaveLength(1);
    expect(result.grammar[0]).toMatchObject({ id: 'g1', topicKey: 'articles', title: 'Articles', mastery: 0.2 });
  });

  it('returns empty arrays when nothing is due', async () => {
    mockLearnerVocabFindMany.mockResolvedValue([]);
    mockLearnerGrammarFindMany.mockResolvedValue([]);

    const result = await getDueItems('course-1');

    expect(result.vocab).toEqual([]);
    expect(result.grammar).toEqual([]);
  });

  it('passes the limit to the findMany take option', async () => {
    mockLearnerVocabFindMany.mockResolvedValue([]);
    mockLearnerGrammarFindMany.mockResolvedValue([]);

    await getDueItems('course-1', 4);

    expect(mockLearnerVocabFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 4 }),
    );
    expect(mockLearnerGrammarFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 4 }),
    );
  });

  it('uses courseId in the where clause', async () => {
    mockLearnerVocabFindMany.mockResolvedValue([]);
    mockLearnerGrammarFindMany.mockResolvedValue([]);

    await getDueItems('course-xyz');

    expect(mockLearnerVocabFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ courseId: 'course-xyz' }) }),
    );
  });
});

// ---- getMemoryGraph ----

describe('getMemoryGraph', () => {
  const PAST_DATE = new Date(Date.now() - 60_000); // 1 min ago → due
  const FUTURE_DATE = new Date(Date.now() + 60_000 * 60 * 24); // tomorrow → not due

  beforeEach(() => {
    vi.clearAllMocks();
    mockVocabEdgeFindMany.mockResolvedValue([]);
  });

  it('maps vocab rows to nodes with kind="vocab", label=lemma, strength=mastery, due based on dueAt', async () => {
    mockLearnerVocabFindMany.mockResolvedValue([
      { id: 'v1', lemma: 'hola', translation: 'hello', mastery: 0.7, dueAt: PAST_DATE },
      { id: 'v2', lemma: 'adios', translation: 'goodbye', mastery: 0.9, dueAt: FUTURE_DATE },
    ]);
    mockLearnerGrammarFindMany.mockResolvedValue([]);

    const graph = await getMemoryGraph('course-1');

    expect(graph.nodes).toHaveLength(2);

    const node1 = graph.nodes.find((n) => n.id === 'v1')!;
    expect(node1.kind).toBe('vocab');
    expect(node1.label).toBe('hola');
    expect(node1.translation).toBe('hello');
    expect(node1.strength).toBe(0.7);
    expect(node1.due).toBe(true);

    const node2 = graph.nodes.find((n) => n.id === 'v2')!;
    expect(node2.due).toBe(false);
  });

  it('maps grammar rows to nodes with kind="grammar", label=title, due=false', async () => {
    mockLearnerVocabFindMany.mockResolvedValue([]);
    mockLearnerGrammarFindMany.mockResolvedValue([
      { id: 'g1', topicKey: 'articles', title: 'Articles', mastery: 0.5 },
    ]);

    const graph = await getMemoryGraph('course-1');

    expect(graph.nodes).toHaveLength(1);
    const node = graph.nodes[0];
    expect(node.kind).toBe('grammar');
    expect(node.label).toBe('Articles');
    expect(node.strength).toBe(0.5);
    expect(node.due).toBe(false);
  });

  it('includes edges that have both source and target', async () => {
    mockLearnerVocabFindMany.mockResolvedValue([
      { id: 'v1', lemma: 'hola', translation: 'hello', mastery: 0.8, dueAt: FUTURE_DATE },
      { id: 'v2', lemma: 'adios', translation: 'goodbye', mastery: 0.6, dueAt: FUTURE_DATE },
    ]);
    mockLearnerGrammarFindMany.mockResolvedValue([]);
    mockVocabEdgeFindMany.mockResolvedValue([
      { type: 'synonym', weight: 0.9, sourceVocabId: 'v1', targetVocabId: 'v2', grammarId: null },
    ]);

    const graph = await getMemoryGraph('course-1');

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ source: 'v1', target: 'v2', type: 'synonym', weight: 0.9 });
  });

  it('filters out edges with a missing source or target', async () => {
    mockLearnerVocabFindMany.mockResolvedValue([]);
    mockLearnerGrammarFindMany.mockResolvedValue([]);
    mockVocabEdgeFindMany.mockResolvedValue([
      // sourceVocabId is null → edge.source will be '' → should be filtered
      { type: 'related', weight: 0.5, sourceVocabId: null, targetVocabId: 'v2', grammarId: null },
      // both null → filtered
      { type: 'related', weight: 0.3, sourceVocabId: null, targetVocabId: null, grammarId: null },
    ]);

    const graph = await getMemoryGraph('course-1');

    expect(graph.edges).toHaveLength(0);
  });

  it('uses grammarId as target when targetVocabId is null', async () => {
    mockLearnerVocabFindMany.mockResolvedValue([
      { id: 'v1', lemma: 'el', translation: 'the', mastery: 0.5, dueAt: FUTURE_DATE },
    ]);
    mockLearnerGrammarFindMany.mockResolvedValue([
      { id: 'g1', topicKey: 'articles', title: 'Articles', mastery: 0.4 },
    ]);
    mockVocabEdgeFindMany.mockResolvedValue([
      { type: 'exemplifies', weight: 1.0, sourceVocabId: 'v1', targetVocabId: null, grammarId: 'g1' },
    ]);

    const graph = await getMemoryGraph('course-1');

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ source: 'v1', target: 'g1' });
  });

  it('returns empty nodes and edges when course has no items', async () => {
    mockLearnerVocabFindMany.mockResolvedValue([]);
    mockLearnerGrammarFindMany.mockResolvedValue([]);
    mockVocabEdgeFindMany.mockResolvedValue([]);

    const graph = await getMemoryGraph('course-1');

    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });
});
