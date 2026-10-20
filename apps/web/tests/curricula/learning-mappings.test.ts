// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { evaluateLevelReadiness, type LearningObjective } from '@sotto/shared';
import { loadAllCurricula } from '../../prisma/curricula/schema';
import {
  reviewedSeedCriterionHash,
  reviewedSeedLessonLinks,
  reviewedSeedObjectives,
  reviewedSeedSourceHash,
} from '../../prisma/learning-maps/seed-links';
import { getLanguageCatalog } from '@/lib/learning-map/catalogs';
import { mapLessonToCatalog } from '@/lib/learning-map/lessons';

const pairs = ['de-from-en', 'en-from-es', 'es-from-en'];
const curricula = loadAllCurricula().filter((curriculum) =>
  pairs.includes(curriculum.manifest.targetLang + '-from-' + curriculum.manifest.nativeLang)
);
function sourceLesson(pair: string, slug: string) {
  const curriculum = curricula.find(
    (candidate) => candidate.manifest.targetLang + '-from-' + candidate.manifest.nativeLang === pair
  );
  if (!curriculum) throw new Error('Missing reviewed curriculum ' + pair);
  const lesson = curriculum.lessons.find((candidate) => candidate.slug === slug);
  if (!lesson) throw new Error('Missing reviewed lesson ' + pair + ':' + slug);
  return { curriculum, lesson };
}

describe('reviewed seed teaching links', () => {
  it('records an exact reviewed source scope for all 42 default lessons', () => {
    expect(curricula).toHaveLength(3);
    expect(reviewedSeedLessonLinks).toHaveLength(42);
    const identities = reviewedSeedLessonLinks.map((row) => row.targetLang + ':' + row.slug);
    expect(new Set(identities).size).toBe(identities.length);
    for (const row of reviewedSeedLessonLinks) {
      const { curriculum, lesson } = sourceLesson(row.pair, row.slug);
      expect(row.targetLang).toBe(curriculum.manifest.targetLang);
      expect(row.level).toBe(lesson.level);
      expect(reviewedSeedSourceHash(lesson)).toBe(row.sourceScopeHash);
      if (!row.objectives.length) expect(row.unresolvedScopes.length).toBeGreaterThan(0);
    }
    expect(curricula.reduce((count, curriculum) => count + curriculum.lessons.length, 0)).toBe(42);
  });

  it('links only actual same-language, same-band criteria at their reviewed revision and meaning', () => {
    for (const row of reviewedSeedLessonLinks) {
      const catalog = getLanguageCatalog(row.targetLang);
      const { lesson } = sourceLesson(row.pair, row.slug);
      expect(row.catalogVersion).toBe(1);
      expect(catalog.version).toBe(row.catalogVersion);
      for (const link of row.objectives) {
        const objective = catalog.nodes.find(
          (node): node is LearningObjective =>
            node.kind === 'OBJECTIVE' && node.id === link.objectiveId
        );
        expect(objective).toBeDefined();
        if (!objective) throw new Error('Missing reviewed objective ' + link.objectiveId);
        expect(objective.id.startsWith(row.targetLang + '.')).toBe(true);
        expect(objective.level).toBe(lesson.level);
        expect(objective.criterionVersion).toBe(1);
        expect(reviewedSeedCriterionHash(objective)).toBe(link.criterionMeaningHash);
        expect(link.rationale.length).toBeGreaterThan(20);
      }
      expect(reviewedSeedObjectives(row.targetLang, row.slug, catalog, lesson)).toEqual(
        row.objectives.map((link) => link.objectiveId)
      );
    }
  });

  it.each([
    {
      target: 'de',
      pair: 'de-from-en',
      slug: 'a2-past-tense-perfect',
      objective: 'de.g.perfekt-haben-sein',
    },
    {
      target: 'en',
      pair: 'en-from-es',
      slug: 'a1-places-directions',
      objective: 'en.s.directions',
    },
    {
      target: 'es',
      pair: 'es-from-en',
      slug: 'a2-plans-future-intentions',
      objective: 'es.g.ir-a-infinitive',
    },
  ])(
    'provides a specific supported teaching link for $pair',
    ({ target, pair, slug, objective }) => {
      const { lesson } = sourceLesson(pair, slug);
      expect(reviewedSeedObjectives(target, slug, getLanguageCatalog(target), lesson)).toEqual([
        objective,
      ]);
      const rows = reviewedSeedLessonLinks.filter((row) => row.pair === pair);
      expect(rows.some((row) => row.level === 'A1' && row.objectives.length > 0)).toBe(true);
      expect(rows.some((row) => row.level === 'A2' && row.objectives.length > 0)).toBe(true);
      expect(rows.some((row) => row.objectives.length === 0)).toBe(true);
    }
  );

  it.each([
    { target: 'de', slug: 'a2-home-living' },
    { target: 'de', slug: 'a2-transport-directions' },
    { target: 'de', slug: 'a1-food-drink' },
    { target: 'es', slug: 'a2-preterite-past-events' },
    { target: 'es', slug: 'a2-shopping-prices' },
    { target: 'es', slug: 'a1-food-drink-ordering' },
    { target: 'en', slug: 'a2-future-plans' },
  ])('keeps partial or cross-band scope unresolved for $target $slug', ({ target, slug }) => {
    expect(reviewedSeedObjectives(target, slug, getLanguageCatalog(target))).toEqual([]);
    expect(
      reviewedSeedLessonLinks.find((row) => row.targetLang === target && row.slug === slug)
        ?.unresolvedScopes.length
    ).toBeGreaterThan(0);
  });

  it('does not classify unknown slugs or legacy aliases into a teaching link', () => {
    const catalog = getLanguageCatalog('de');
    for (const slug of [
      'a2-perfect-tense',
      'plusquamperfekt',
      'konjunktiv-ii',
      'a1-order-food-and-shopping',
    ])
      expect(reviewedSeedObjectives('de', slug, catalog)).toEqual([]);
    expect(
      reviewedSeedObjectives('fr', 'a1-greetings-introductions', getLanguageCatalog('fr'))
    ).toEqual([]);
    expect(reviewedSeedObjectives('de', 'a1-family-people', getLanguageCatalog('en'))).toEqual([]);
  });

  it('rejects catalog, criterion, meaning, and band drift instead of adopting old links', () => {
    const original = getLanguageCatalog('de');
    const slug = 'a2-past-tense-perfect';
    expect(reviewedSeedObjectives('de', slug, { ...original, version: 2 })).toEqual([]);
    for (const change of ['criterion', 'assessment', 'level'] as const) {
      const catalog = structuredClone(original);
      const objective = catalog.nodes.find(
        (node): node is LearningObjective =>
          node.kind === 'OBJECTIVE' && node.id === 'de.g.perfekt-haben-sein'
      )!;
      if (change === 'criterion') objective.criterionVersion++;
      if (change === 'assessment') objective.assessment = 'Use a different past construction.';
      if (change === 'level') objective.level = 'B1';
      expect(reviewedSeedObjectives('de', slug, catalog)).toEqual([]);
    }
  });

  it('preserves structural criterion identity when rubric key order changes', () => {
    const catalog = structuredClone(getLanguageCatalog('de'));
    const objective = catalog.nodes.find(
      (node): node is LearningObjective =>
        node.kind === 'OBJECTIVE' && node.id === 'de.g.perfekt-haben-sein'
    )!;
    objective.skillCriteria = Object.fromEntries(Object.entries(objective.skillCriteria).reverse());
    expect(reviewedSeedObjectives('de', 'a2-past-tense-perfect', catalog)).toEqual([
      'de.g.perfekt-haben-sein',
    ]);
  });

  it('rejects changed seed source fields when the actual source is supplied', () => {
    const catalog = getLanguageCatalog('de');
    const slug = 'a1-nouns-articles-gender';
    const { lesson } = sourceLesson('de-from-en', slug);
    expect(reviewedSeedObjectives('de', slug, catalog, lesson)).toEqual(['de.g.articles-gender']);
    for (const changed of [
      { ...lesson, objective: 'Teach a different construction.' },
      { ...lesson, grammarPoints: [...lesson.grammarPoints, 'unreviewed-scope'] },
      { ...lesson, canDoSummary: 'A different communicative goal.' },
    ])
      expect(reviewedSeedObjectives('de', slug, catalog, changed)).toEqual([]);
  });

  it('publishes teaching scope without resolving unrelated keys or creating learner mastery', () => {
    const catalog = getLanguageCatalog('de');
    const { lesson } = sourceLesson('de-from-en', 'a1-nouns-articles-gender');
    const beforeCatalog = structuredClone(catalog);
    const beforeLesson = structuredClone(lesson);
    const learningObjectiveIds = reviewedSeedObjectives('de', lesson.slug, catalog, lesson);
    const result = mapLessonToCatalog(catalog, { ...lesson, learningObjectiveIds });
    expect(result.objectives).toEqual([
      { objectiveId: 'de.g.articles-gender', criterionVersion: 1, role: 'EXPLICIT_GENERATION' },
    ]);
    expect(result.unresolvedGrammarKeys).toEqual(lesson.grammarPoints);
    expect(result.unresolved).toBe(true);
    const readiness = evaluateLevelReadiness(
      catalog,
      'A1',
      [],
      [],
      new Date('2026-10-20T12:00:00.000Z')
    );
    expect(readiness.ready).toBe(false);
    expect(readiness.unassessedCount).toBeGreaterThan(0);
    expect(catalog).toEqual(beforeCatalog);
    expect(lesson).toEqual(beforeLesson);
  });
});
