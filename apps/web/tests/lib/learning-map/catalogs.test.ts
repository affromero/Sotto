import { describe, expect, it, vi } from 'vitest';
import { learningLevels, type LearningCatalog, type LearningObjective } from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import { learningCatalogHash, publishLearningCatalog } from '@/lib/learning-map/catalog';
import { germanCatalog } from '@/lib/learning-map/catalogs/europe/de';
import { japaneseCatalog } from '@/lib/learning-map/catalogs/asia/ja';
import { publishedLanguageCatalogs, getLanguageCatalog } from '@/lib/learning-map/catalogs';
import { LANG_LABELS } from '@/lib/languages';

describe('language-specific learning catalogs', () => {
  it.each([
    {
      catalog: germanCatalog,
      name: 'German',
      objectiveId: 'de.g.als-wenn-past',
      term: 'als or wenn',
    },
    { catalog: japaneseCatalog, name: 'Japanese', objectiveId: 'ja.g.topic-wa', term: 'は' },
  ])('assesses $name grammar and independent writing through different rubrics', (testCase) => {
    const objective = testCase.catalog.nodes.find(
      (node): node is LearningObjective =>
        node.kind === 'OBJECTIVE' && node.id === testCase.objectiveId
    )!;
    expect(Object.keys(objective.skillCriteria).sort()).toEqual(['GRAMMAR', 'WRITING']);
    expect(objective.skillCriteria.GRAMMAR).toContain(testCase.name);
    expect(objective.skillCriteria.GRAMMAR).toContain(testCase.term);
    expect(objective.skillCriteria.GRAMMAR).toContain('choose or construct');
    expect(objective.skillCriteria.WRITING).toContain(testCase.name);
    expect(objective.skillCriteria.WRITING).toContain(testCase.term);
    expect(objective.skillCriteria.WRITING).toContain('independently');
    expect(objective.skillCriteria.WRITING).not.toBe(objective.skillCriteria.GRAMMAR);
  });

  it.each([
    { catalog: germanCatalog, name: 'German' },
    { catalog: japaneseCatalog, name: 'Japanese' },
  ])(
    'separates comprehension and independent production for $name situations',
    ({ catalog, name }) => {
      const objective = catalog.nodes.find(
        (node): node is LearningObjective =>
          node.kind === 'OBJECTIVE' && node.id.endsWith('.s.order-food')
      )!;
      const criteria = objective.skillCriteria;
      expect(Object.keys(criteria).sort()).toEqual(['LISTENING', 'READING', 'SPEAKING', 'WRITING']);
      for (const rubric of Object.values(criteria)) {
        expect(rubric).toContain(name);
        expect(rubric).toContain(objective.title);
        expect(rubric!.length).toBeLessThanOrEqual(2000);
        expect(rubric).toContain(objective.assessment);
      }
      expect(criteria.READING).toContain('written exchange');
      expect(criteria.READING).toContain('intent and relevant constraints');
      expect(criteria.LISTENING).toContain('exact supplied');
      expect(criteria.LISTENING).toContain('spoken exchange');
      expect(criteria.LISTENING).toContain('what was heard');
      expect(criteria.WRITING).toContain('Independently write');
      expect(criteria.SPEAKING).toContain('Independently respond aloud');
      expect(criteria.SPEAKING).toContain('without reading a supplied target phrase');
    }
  );

  it.each(publishedLanguageCatalogs())(
    '$title offers both branches at every maintained band',
    (catalog) => {
      for (const level of learningLevels)
        for (const branch of ['GRAMMAR', 'SITUATIONS'] as const) {
          const objectives = catalog.nodes.filter(
            (node) => node.kind === 'OBJECTIVE' && node.level === level && node.branch === branch
          );
          expect(objectives.length).toBeGreaterThanOrEqual(4);
          expect(
            objectives.every((node) => node.kind === 'OBJECTIVE' && node.examples.length > 0)
          ).toBe(true);
        }
    }
  );
  it('publishes a separate catalog for every language offered in courses', () => {
    expect(
      publishedLanguageCatalogs()
        .map((catalog) => catalog.targetLang)
        .sort()
    ).toEqual(Object.keys(LANG_LABELS).sort());
  });
  it('represents Mandarin aspect and classifiers and Korean case particles explicitly', () => {
    const chinese = getLanguageCatalog('zh');
    expect(
      chinese.nodes.some((node) => node.kind === 'OBJECTIVE' && node.title.includes('了'))
    ).toBe(true);
    expect(
      chinese.nodes.some((node) => node.kind === 'OBJECTIVE' && node.title.includes('classifier'))
    ).toBe(true);
    expect(
      getLanguageCatalog('ko').nodes.some(
        (node) => node.kind === 'OBJECTIVE' && node.title.includes('subject 이가')
      )
    ).toBe(true);
  });

  it('preserves specific temporal distinctions and distinct passive constructions', () => {
    const titles = germanCatalog.nodes.map((node) => node.title);
    expect(titles).toContain('Choose als or wenn for past events');
    expect(titles).toContain('Sequence past events using nachdem');
    expect(titles).toContain('Form the present passive');
    expect(titles).toContain('Form the past passive');
  });

  it('teaches Japanese structures rather than translating German categories', () => {
    const objectives = japaneseCatalog.nodes.filter(
      (node) => node.kind === 'OBJECTIVE' && node.branch === 'GRAMMAR'
    );
    expect(objectives.some((node) => node.title.includes('は'))).toBe(true);
    expect(objectives.some((node) => node.title.includes('respectful and humble'))).toBe(true);
    expect(objectives.some((node) => node.title.includes('dative'))).toBe(false);
  });
});

function publicationDatabase(prior: LearningCatalog, candidate: LearningCatalog) {
  const next = {
    id: 'revision-next',
    targetLang: candidate.targetLang,
    version: candidate.version,
    catalogHash: learningCatalogHash(candidate),
    definition: candidate,
  };
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    learningMapRevision: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'revision-prior',
          targetLang: prior.targetLang,
          version: prior.version,
          catalogHash: learningCatalogHash(prior),
          definition: prior,
        },
      ]),
      upsert: vi.fn().mockResolvedValue(next),
    },
    learningNodeIdentity: {
      createMany: vi.fn().mockResolvedValue({ count: candidate.nodes.length }),
    },
  } as unknown as Prisma.TransactionClient;
}

describe('published rubric meaning', () => {
  it('requires a new criterion revision when an existing skill rubric changes', async () => {
    const candidate = structuredClone(germanCatalog);
    candidate.version++;
    const objective = candidate.nodes.find(
      (node): node is LearningObjective => node.kind === 'OBJECTIVE'
    )!;
    objective.skillCriteria.WRITING = 'Independently write an explanation of an unrelated rule.';
    await expect(
      publishLearningCatalog(publicationDatabase(germanCatalog, candidate), candidate)
    ).rejects.toThrow('new criterion revision');
  });

  it('accepts a deliberate rubric revision with an increased criterion version', async () => {
    const candidate = structuredClone(germanCatalog);
    candidate.version++;
    const objective = candidate.nodes.find(
      (node): node is LearningObjective => node.kind === 'OBJECTIVE'
    )!;
    objective.criterionVersion++;
    objective.skillCriteria.WRITING =
      'Independently express identification and possession in an original German response.';
    const published = await publishLearningCatalog(
      publicationDatabase(germanCatalog, candidate),
      candidate
    );
    expect(published.version).toBe(candidate.version);
    expect(published.catalogHash).toBe(learningCatalogHash(candidate));
  });

  it('preserves criterion meaning when only rubric object key order changes', async () => {
    const candidate = structuredClone(germanCatalog);
    candidate.version++;
    for (const objective of candidate.nodes) {
      if (objective.kind !== 'OBJECTIVE') continue;
      objective.skillCriteria = Object.fromEntries(
        Object.entries(objective.skillCriteria).reverse()
      );
    }
    const published = await publishLearningCatalog(
      publicationDatabase(germanCatalog, candidate),
      candidate
    );
    expect(published.version).toBe(candidate.version);
  });
});
