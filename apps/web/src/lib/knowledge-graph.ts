// The learner's per-course vocabulary/grammar memory graph + SRS scheduling.
// Seeds nodes from a lesson, updates SRS from class outcomes, and surfaces the
// due/weak items that drive the next class's adaptive content and the graph viz.
import { prisma } from './prisma';
import { reviewCard } from './srs';
import type { CefrLevel } from '@sotto/shared';

export interface VocabItem {
  lemma: string;
  gloss: string;
  pos?: string;
  pronunciation?: string;
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
  grammarPoints: string[],
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

/** Update SRS for a lesson's vocab + grammar from per-section scores (0..1). */
export async function applyReviewOutcome(
  courseId: string,
  vocabLemmas: string[],
  grammarPoints: string[],
  vocabQuality: number,
  grammarQuality: number,
  now: Date,
): Promise<void> {
  const vocab = await prisma.learnerVocab.findMany({ where: { courseId, lemma: { in: vocabLemmas } } });
  for (const v of vocab) {
    const u = reviewCard(
      { ease: v.ease, intervalDays: v.intervalDays, reps: v.reps, lapses: v.lapses, mastery: v.mastery },
      vocabQuality,
      now,
    );
    await prisma.learnerVocab.update({ where: { id: v.id }, data: { ...u, lastReviewed: now } });
  }

  const grammar = await prisma.learnerGrammar.findMany({ where: { courseId, topicKey: { in: grammarPoints } } });
  for (const g of grammar) {
    const u = reviewCard(
      { ease: g.ease, intervalDays: g.intervalDays, reps: g.reps, lapses: g.lapses, mastery: g.mastery },
      grammarQuality,
      now,
    );
    await prisma.learnerGrammar.update({ where: { id: g.id }, data: { ...u, lastReviewed: now } });
  }
}

export interface DueItems {
  vocab: Array<{ id: string; lemma: string; translation: string; mastery: number }>;
  grammar: Array<{ id: string; topicKey: string; title: string; mastery: number }>;
}

/** Due-or-weak items, used to seed adaptive class content + the listening podcast. */
export async function getDueItems(courseId: string, limit = 8): Promise<DueItems> {
  const now = new Date();
  const dueOrWeak = { OR: [{ dueAt: { lte: now } }, { mastery: { lt: 0.5 } }] };
  const [vocab, grammar] = await Promise.all([
    prisma.learnerVocab.findMany({
      where: { courseId, ...dueOrWeak },
      orderBy: [{ dueAt: 'asc' }, { mastery: 'asc' }],
      take: limit,
      select: { id: true, lemma: true, translation: true, mastery: true },
    }),
    prisma.learnerGrammar.findMany({
      where: { courseId, ...dueOrWeak },
      orderBy: [{ dueAt: 'asc' }, { mastery: 'asc' }],
      take: limit,
      select: { id: true, topicKey: true, title: true, mastery: true },
    }),
  ]);
  return { vocab, grammar };
}

export interface MemoryGraph {
  nodes: Array<{ id: string; kind: 'vocab' | 'grammar'; label: string; translation?: string; strength: number; due: boolean }>;
  edges: Array<{ source: string; target: string; type: string; weight: number }>;
}

/** Whole course graph for the Obsidian-style visualization (rendered in a later phase). */
export async function getMemoryGraph(courseId: string): Promise<MemoryGraph> {
  const now = Date.now();
  const [vocab, grammar, edges] = await Promise.all([
    prisma.learnerVocab.findMany({
      where: { courseId },
      select: { id: true, lemma: true, translation: true, mastery: true, dueAt: true },
    }),
    prisma.learnerGrammar.findMany({
      where: { courseId },
      select: { id: true, topicKey: true, title: true, mastery: true },
    }),
    prisma.vocabEdge.findMany({
      where: { courseId },
      select: { type: true, weight: true, sourceVocabId: true, targetVocabId: true, grammarId: true },
    }),
  ]);

  const nodes: MemoryGraph['nodes'] = [
    ...vocab.map((v) => ({
      id: v.id,
      kind: 'vocab' as const,
      label: v.lemma,
      translation: v.translation,
      strength: v.mastery,
      due: v.dueAt.getTime() <= now,
    })),
    ...grammar.map((g) => ({ id: g.id, kind: 'grammar' as const, label: g.title, strength: g.mastery, due: false })),
  ];

  const graphEdges = edges
    .map((e) => ({
      source: e.sourceVocabId ?? '',
      target: e.targetVocabId ?? e.grammarId ?? '',
      type: e.type as string,
      weight: e.weight,
    }))
    .filter((e) => e.source && e.target);

  return { nodes, edges: graphEdges };
}
