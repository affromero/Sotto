// The learner's per-course vocabulary/grammar memory graph + SRS scheduling.
// Seeds nodes from a lesson, updates SRS from class outcomes, and surfaces the
// due/weak items that drive the next class's adaptive content and the graph viz.
import { prisma } from './prisma';
import { reviewCard } from './srs';
import { normalizeLearningTargetText } from './learning-targets';
import { rankLearningTargets } from '@sotto/learning-model';
import type { CefrLevel } from '@sotto/shared';

export interface VocabItem {
  lemma: string;
  gloss: string;
  pos?: string;
  pronunciation?: string;
}

export interface GrammarItem {
  key: string;
  title?: string;
}

function humanizeKey(key: string): string {
  return key.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Idempotently create the course's vocab + grammar nodes for a lesson. */
export async function seedLessonItems(
  courseId: string,
  classId: string,
  level: CefrLevel,
  vocab: VocabItem[],
  grammarPoints: string[]
): Promise<void> {
  for (const v of vocab) {
    if (!v.lemma) continue;
    await prisma.learnerVocab.upsert({
      where: { courseId_lemma: { courseId, lemma: v.lemma } },
      create: {
        courseId,
        lemma: v.lemma,
        translation: v.gloss ?? '',
        partOfSpeech: v.pos ?? null,
        pronunciation: v.pronunciation ?? null,
        firstSeenClassId: classId,
        cefrLevel: level,
      },
      update: {},
    });
  }
  for (const key of grammarPoints) {
    if (!key) continue;
    await prisma.learnerGrammar.upsert({
      where: { courseId_topicKey: { courseId, topicKey: key } },
      create: { courseId, topicKey: key, title: humanizeKey(key), cefrLevel: level },
      update: {},
    });
  }
}

/**
 * Add vocab surfaced during a live conversation (no class) to the course graph.
 * Mirrors the seedLessonItems upsert but with no firstSeenClassId. Returns the
 * count of lemmas that were newly created (already-known words are left as-is so
 * their SRS state is preserved).
 */
export async function upsertLiveVocab(
  courseId: string,
  items: VocabItem[],
  level?: CefrLevel
): Promise<number> {
  const lemmas = items.map((i) => i.lemma).filter(Boolean);
  if (lemmas.length === 0) return 0;
  const existing = new Set(
    (
      await prisma.learnerVocab.findMany({
        where: { courseId, lemma: { in: lemmas } },
        select: { lemma: true },
      })
    ).map((r) => r.lemma)
  );

  let added = 0;
  for (const v of items) {
    if (!v.lemma) continue;
    await prisma.learnerVocab.upsert({
      where: { courseId_lemma: { courseId, lemma: v.lemma } },
      create: {
        courseId,
        lemma: v.lemma,
        translation: v.gloss ?? '',
        partOfSpeech: v.pos ?? null,
        pronunciation: v.pronunciation ?? null,
        firstSeenClassId: null,
        cefrLevel: level ?? null,
      },
      update: {},
    });
    if (!existing.has(v.lemma)) added++;
  }
  return added;
}

/**
 * Add grammar targets surfaced from course notes or other private learner
 * context. Existing topics keep their SRS state; new ones enter with low
 * mastery so catch-up practice can rank and test them.
 */
export async function upsertCourseGrammar(
  courseId: string,
  items: GrammarItem[],
  level?: CefrLevel
): Promise<number> {
  const keys = items.map((i) => i.key).filter(Boolean);
  if (keys.length === 0) return 0;
  const existing = new Set(
    (
      await prisma.learnerGrammar.findMany({
        where: { courseId, topicKey: { in: keys } },
        select: { topicKey: true },
      })
    ).map((r) => r.topicKey)
  );

  let added = 0;
  for (const item of items) {
    if (!item.key) continue;
    await prisma.learnerGrammar.upsert({
      where: { courseId_topicKey: { courseId, topicKey: item.key } },
      create: {
        courseId,
        topicKey: item.key,
        title: item.title?.trim() || humanizeKey(item.key),
        cefrLevel: level ?? null,
      },
      update: {},
    });
    if (!existing.has(item.key)) added++;
  }
  return added;
}

/** Update SRS for a lesson's vocab + grammar from per-section scores (0..1). */
export async function applyReviewOutcome(
  courseId: string,
  vocabLemmas: string[],
  grammarPoints: string[],
  vocabQuality: number,
  grammarQuality: number,
  now: Date
): Promise<void> {
  const vocab = await prisma.learnerVocab.findMany({
    where: { courseId, lemma: { in: vocabLemmas } },
  });
  for (const v of vocab) {
    const u = reviewCard(
      {
        ease: v.ease,
        intervalDays: v.intervalDays,
        reps: v.reps,
        lapses: v.lapses,
        mastery: v.mastery,
      },
      vocabQuality,
      now
    );
    await prisma.learnerVocab.update({ where: { id: v.id }, data: { ...u, lastReviewed: now } });
  }

  const grammar = await prisma.learnerGrammar.findMany({
    where: { courseId, topicKey: { in: grammarPoints } },
  });
  for (const g of grammar) {
    const u = reviewCard(
      {
        ease: g.ease,
        intervalDays: g.intervalDays,
        reps: g.reps,
        lapses: g.lapses,
        mastery: g.mastery,
      },
      grammarQuality,
      now
    );
    await prisma.learnerGrammar.update({ where: { id: g.id }, data: { ...u, lastReviewed: now } });
  }
}

export interface DueItems {
  vocab: Array<{ id: string; lemma: string; translation: string; mastery: number }>;
  grammar: Array<{ id: string; topicKey: string; title: string; mastery: number }>;
}

/** Adaptive due-or-weak items, used to seed practice, classes, and listening. */
export async function getDueItems(courseId: string, limit = 8): Promise<DueItems> {
  const now = new Date();
  const dueOrWeak = { OR: [{ dueAt: { lte: now } }, { mastery: { lt: 0.5 } }] };
  const candidateLimit = Math.max(limit, limit * 4);
  const [focusTargets, vocab, grammar] = await Promise.all([
    prisma.learnerFocusTarget.findMany({
      where: { courseId, kind: { in: ['WORD', 'PHRASE'] } },
      orderBy: [{ priorityBoost: 'desc' }, { lastSelectedAt: 'desc' }],
      take: candidateLimit,
      select: { normalizedText: true, priorityBoost: true },
    }),
    prisma.learnerVocab.findMany({
      where: { courseId, ...dueOrWeak },
      orderBy: [{ dueAt: 'asc' }, { mastery: 'asc' }],
      take: candidateLimit,
      select: {
        id: true,
        lemma: true,
        translation: true,
        mastery: true,
        reps: true,
        lapses: true,
        dueAt: true,
        lastReviewed: true,
      },
    }),
    prisma.learnerGrammar.findMany({
      where: { courseId, ...dueOrWeak },
      orderBy: [{ dueAt: 'asc' }, { mastery: 'asc' }],
      take: candidateLimit,
      select: {
        id: true,
        topicKey: true,
        title: true,
        mastery: true,
        reps: true,
        lapses: true,
        dueAt: true,
        lastReviewed: true,
      },
    }),
  ]);
  const focusByText = new Map(
    focusTargets.map((target) => [target.normalizedText, target.priorityBoost])
  );
  const boostedVocab = vocab.map((item) => {
    const boost = focusByText.get(normalizeLearningTargetText(item.lemma)) ?? 0;
    if (boost <= 0) return { ...item, actualMastery: item.mastery };
    return {
      ...item,
      actualMastery: item.mastery,
      mastery: Math.max(0, item.mastery - boost),
      lapses: item.lapses + 1,
      dueAt: item.dueAt.getTime() <= now.getTime() ? item.dueAt : now,
    };
  });
  return {
    vocab: rankLearningTargets(boostedVocab, now)
      .slice(0, limit)
      .map(({ id, lemma, translation, actualMastery }) => ({
        id,
        lemma,
        translation,
        mastery: actualMastery,
      })),
    grammar: rankLearningTargets(grammar, now)
      .slice(0, limit)
      .map(({ id, topicKey, title, mastery }) => ({ id, topicKey, title, mastery })),
  };
}

export interface MemoryGraph {
  nodes: Array<{
    id: string;
    kind: 'vocab' | 'grammar';
    label: string;
    translation?: string;
    strength: number;
    due: boolean;
    createdAt: string | null;
    updatedAt: string | null;
    dueAt: string | null;
    lastReviewed: string | null;
    cefrLevel: CefrLevel | null;
    reviewCount: number;
    lapseCount: number;
    partOfSpeech?: string | null;
    pronunciation?: string | null;
    topicKey?: string;
  }>;
  edges: Array<{
    source: string;
    target: string;
    type: string;
    weight: number;
    createdAt: string | null;
  }>;
}

function toIsoDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/** Whole course graph for the learner-facing memory visualization. */
export async function getMemoryGraph(courseId: string): Promise<MemoryGraph> {
  const now = Date.now();
  const [vocab, grammar, edges] = await Promise.all([
    prisma.learnerVocab.findMany({
      where: { courseId },
      select: {
        id: true,
        lemma: true,
        translation: true,
        partOfSpeech: true,
        pronunciation: true,
        mastery: true,
        dueAt: true,
        reps: true,
        lapses: true,
        lastReviewed: true,
        cefrLevel: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.learnerGrammar.findMany({
      where: { courseId },
      select: {
        id: true,
        topicKey: true,
        title: true,
        mastery: true,
        dueAt: true,
        reps: true,
        lapses: true,
        lastReviewed: true,
        cefrLevel: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.vocabEdge.findMany({
      where: { courseId },
      select: {
        type: true,
        weight: true,
        sourceVocabId: true,
        targetVocabId: true,
        grammarId: true,
        createdAt: true,
      },
    }),
  ]);

  const nodes: MemoryGraph['nodes'] = [
    ...vocab.map((v) => ({
      id: v.id,
      kind: 'vocab' as const,
      label: v.lemma,
      translation: v.translation,
      partOfSpeech: v.partOfSpeech,
      pronunciation: v.pronunciation,
      strength: v.mastery,
      due: v.dueAt ? v.dueAt.getTime() <= now : false,
      createdAt: toIsoDate(v.createdAt),
      updatedAt: toIsoDate(v.updatedAt),
      dueAt: toIsoDate(v.dueAt),
      lastReviewed: toIsoDate(v.lastReviewed),
      cefrLevel: v.cefrLevel,
      reviewCount: v.reps ?? 0,
      lapseCount: v.lapses ?? 0,
    })),
    ...grammar.map((g) => ({
      id: g.id,
      kind: 'grammar' as const,
      label: g.title,
      topicKey: g.topicKey,
      strength: g.mastery,
      due: g.dueAt ? g.dueAt.getTime() <= now : false,
      createdAt: toIsoDate(g.createdAt),
      updatedAt: toIsoDate(g.updatedAt),
      dueAt: toIsoDate(g.dueAt),
      lastReviewed: toIsoDate(g.lastReviewed),
      cefrLevel: g.cefrLevel,
      reviewCount: g.reps ?? 0,
      lapseCount: g.lapses ?? 0,
    })),
  ];

  const graphEdges = edges
    .map((e) => ({
      source: e.sourceVocabId ?? '',
      target: e.targetVocabId ?? e.grammarId ?? '',
      type: e.type as string,
      weight: e.weight,
      createdAt: toIsoDate(e.createdAt),
    }))
    .filter((e) => e.source && e.target);

  return { nodes, edges: graphEdges };
}
