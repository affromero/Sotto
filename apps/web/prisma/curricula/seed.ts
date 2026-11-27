import { isDeepStrictEqual } from 'node:util';
import type { PrismaClient } from '../../src/generated/prisma/client';
import {
  learningCatalogHash,
  readPublishedLearningCatalog,
} from '../../src/lib/learning-map/catalog';
import { languageCatalogAvailability } from '../../src/lib/learning-map/catalogs';
import {
  mapLessonToCatalog,
  publishCurriculumLearningMappings,
} from '../../src/lib/learning-map/lessons';
import { reviewedSeedObjectives } from '../learning-maps/seed-links';
import type { LoadedCurriculum } from './schema';

function lessonData(lesson: LoadedCurriculum['lessons'][number]) {
  return {
    level: lesson.level,
    order: lesson.order,
    title: lesson.title,
    objective: lesson.objective,
    grammarPoints: lesson.grammarPoints,
    vocabThemes: lesson.vocabThemes,
    targetVocab: lesson.targetVocab,
    canDoSummary: lesson.canDoSummary ?? null,
    estMinutes: lesson.estMinutes,
  };
}

/** An explicit ID selects additive seeding and permits read-only reconciliation. */
export function seedCurriculum(
  prisma: PrismaClient,
  { manifest, lessons }: LoadedCurriculum,
  missingId?: string,
  expectedReceipt?: unknown
) {
  const pair = { nativeLang: manifest.nativeLang, targetLang: manifest.targetLang };
  const source = { title: manifest.title, version: manifest.version, source: 'seeded' };
  const where = { nativeLang_targetLang: pair };
  const availability = languageCatalogAvailability(manifest.targetLang);
  const catalog = availability.status === 'PUBLISHED' ? availability.catalog : null;
  const catalogRevision = catalog && {
    version: catalog.version,
    hash: learningCatalogHash(catalog),
  };
  const authored = lessons.map((lesson) => ({
    ...lesson,
    learningObjectiveIds:
      availability.status === 'PUBLISHED'
        ? reviewedSeedObjectives(manifest.targetLang, lesson.slug, availability.catalog, lesson)
        : [],
  }));
  function verifyReceipt<Mapping extends object>(mapping: Mapping) {
    if (
      expectedReceipt !== undefined &&
      !isDeepStrictEqual({ ...pair, ...mapping }, expectedReceipt)
    ) {
      throw new Error('Curriculum seed result differs from the admitted receipt.');
    }
    return mapping;
  }
  return prisma.$transaction(
    async (database) => {
      if (missingId !== undefined) {
        const existing = await database.curriculum.findUnique({
          where,
          include: {
            lessons: { include: { learningObjectives: true } },
          },
        });
        if (existing) {
          if (
            existing.id !== missingId ||
            existing.title !== source.title ||
            existing.version !== source.version ||
            existing.source !== source.source ||
            existing.lessons.length !== authored.length
          ) {
            throw new Error('Existing curriculum differs from admitted additive seed.');
          }
          if (catalogRevision) {
            const revision = await database.learningMapRevision.findUnique({
              where: {
                targetLang_version: {
                  targetLang: manifest.targetLang,
                  version: catalogRevision.version,
                },
              },
            });
            if (!revision || revision.catalogHash !== catalogRevision.hash) {
              throw new Error('Published catalog differs from admitted additive seed.');
            }
            readPublishedLearningCatalog(revision);
          }
          const bySlug = new Map(existing.lessons.map((item) => [item.slug, item]));
          let mapped = 0;
          let unresolved = 0;
          for (const lesson of authored) {
            const actual = bySlug.get(lesson.slug);
            if (!actual) throw new Error('Existing lessons differ from admitted additive seed.');
            const expected = lessonData(lesson);
            const fields = Object.fromEntries(
              Object.keys(expected).map((field) => [field, actual[field as keyof typeof expected]])
            );
            const result = catalog ? mapLessonToCatalog(catalog, lesson) : null;
            const links = actual.learningObjectives
              .map(({ objectiveId, criterionVersion, role }) => ({
                objectiveId,
                criterionVersion,
                role,
              }))
              .sort((a, b) => a.objectiveId.localeCompare(b.objectiveId));
            const expectedLinks = (result?.objectives ?? [])
              .slice()
              .sort((a, b) => a.objectiveId.localeCompare(b.objectiveId));
            if (
              actual.parentId !== null ||
              !isDeepStrictEqual(fields, expected) ||
              !isDeepStrictEqual(links, expectedLinks)
            ) {
              throw new Error('Existing lessons differ from admitted additive seed.');
            }
            mapped += links.length;
            if (!result || result.unresolved) unresolved++;
          }
          return verifyReceipt({
            curriculumId: existing.id,
            status: availability.status,
            lessons: lessons.length,
            mapped,
            unresolved,
            catalogRevision,
          });
        }
      }
      const curriculum =
        missingId === undefined
          ? await database.curriculum.upsert({
              where,
              create: { ...pair, ...source },
              update: source,
            })
          : await database.curriculum.create({ data: { id: missingId, ...pair, ...source } });
      for (const lesson of lessons) {
        const data = lessonData(lesson);
        const create = { curriculumId: curriculum.id, slug: lesson.slug, ...data };
        if (missingId === undefined) {
          await database.lesson.upsert({
            where: { curriculumId_slug: { curriculumId: curriculum.id, slug: lesson.slug } },
            create,
            update: data,
          });
        } else {
          await database.lesson.create({ data: create });
        }
      }
      const mapping = await publishCurriculumLearningMappings(
        database,
        curriculum.id,
        manifest.targetLang,
        authored
      );
      return verifyReceipt({ curriculumId: curriculum.id, ...mapping, catalogRevision });
    },
    { timeout: 30000 }
  );
}
