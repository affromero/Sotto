import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { learningCatalogSchema, type LearningCatalog } from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import { getLanguageCatalog } from './catalogs';

function canonicalCatalogValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalCatalogValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => [key, canonicalCatalogValue(child)])
  );
}

export function learningCatalogHash(catalog: LearningCatalog): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalCatalogValue(catalog)))
    .digest('hex');
}

export function readPublishedLearningCatalog(revision: {
  definition: unknown;
  targetLang: string;
  version: number;
  catalogHash: string;
}) {
  const catalog = learningCatalogSchema.parse(revision.definition);
  if (
    catalog.targetLang !== revision.targetLang ||
    catalog.version !== revision.version ||
    learningCatalogHash(catalog) !== revision.catalogHash
  )
    throw new Error('A published learning catalog failed its identity or content check.');
  return catalog;
}

/** Publication is explicit mutation work, never an implicit side effect of rendering a page. */
export async function publishLearningCatalog(
  database: Pick<
    Prisma.TransactionClient,
    'learningMapRevision' | 'learningNodeIdentity' | '$executeRaw'
  >,
  input: LearningCatalog
) {
  const catalog = learningCatalogSchema.parse(input);
  await database.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sotto:learning-catalog:${catalog.targetLang}`}, 0))`;
  const catalogHash = learningCatalogHash(catalog);
  const previous = await database.learningMapRevision.findUnique({
    where: { targetLang_version: { targetLang: catalog.targetLang, version: catalog.version } },
  });
  if (previous) {
    readPublishedLearningCatalog(previous);
    if (previous.catalogHash !== catalogHash)
      throw new Error('A published learning catalog cannot be changed in place.');
    return previous;
  }
  const history = await database.learningMapRevision.findMany({
    where: { targetLang: catalog.targetLang },
    orderBy: { version: 'desc' },
  });
  if (history[0] && catalog.version <= history[0].version)
    throw new Error('New learning catalog publications must increase the version.');
  for (const revision of history) {
    const prior = readPublishedLearningCatalog(revision);
    const byId = new Map(prior.nodes.map((node) => [node.id, node]));
    for (const node of catalog.nodes) {
      const old = byId.get(node.id);
      if (old && (old.kind !== node.kind || old.branch !== node.branch))
        throw new Error('A learning identity cannot change its branch or kind.');
      if (
        old?.kind === 'OBJECTIVE' &&
        node.kind === 'OBJECTIVE' &&
        old.criterionVersion === node.criterionVersion &&
        (old.assessment !== node.assessment ||
          old.level !== node.level ||
          JSON.stringify(old.skills) !== JSON.stringify(node.skills) ||
          !isDeepStrictEqual(old.skillCriteria, node.skillCriteria))
      )
        throw new Error('Changed assessment meaning needs a new criterion revision.');
    }
  }
  await database.learningNodeIdentity.createMany({
    data: catalog.nodes.map((node) => ({
      id: node.id,
      targetLang: catalog.targetLang,
      branch: node.branch,
      kind: node.kind,
    })),
    skipDuplicates: true,
  });
  return database.learningMapRevision
    .upsert({
      where: { targetLang_version: { targetLang: catalog.targetLang, version: catalog.version } },
      create: {
        targetLang: catalog.targetLang,
        version: catalog.version,
        catalogHash,
        definition: catalog as unknown as Prisma.InputJsonValue,
      },
      update: {},
    })
    .then((revision) => {
      if (revision.catalogHash !== catalogHash)
        throw new Error('A concurrent catalog publication has different content.');
      return revision;
    });
}

export async function readCourseCatalog(
  database: Prisma.TransactionClient,
  course: { id: string; targetLang: string; currentLevel: import('@sotto/shared').CefrLevel }
) {
  const binding = await database.learningLevelBinding.findUnique({
    where: { courseId_level: { courseId: course.id, level: course.currentLevel } },
    include: { revision: true },
  });
  const catalog = binding
    ? readPublishedLearningCatalog(binding.revision)
    : getLanguageCatalog(course.targetLang);
  if (catalog.targetLang !== course.targetLang)
    throw new Error('Course learning catalog has a different target language.');
  return {
    catalog,
    catalogHash: binding?.revision.catalogHash ?? learningCatalogHash(catalog),
    binding,
  };
}
