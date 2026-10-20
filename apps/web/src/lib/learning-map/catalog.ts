import { createHash } from 'node:crypto';
import { learningCatalogSchema, type LearningCatalog } from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import { getLanguageCatalog } from './catalogs';

export function learningCatalogHash(catalog: LearningCatalog): string {
  return createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
}

/** Publication is explicit mutation work, never an implicit side effect of rendering a page. */
export async function publishLearningCatalog(
  database: Prisma.TransactionClient,
  input: LearningCatalog
) {
  const catalog = learningCatalogSchema.parse(input);
  const catalogHash = learningCatalogHash(catalog);
  const previous = await database.learningMapRevision.findUnique({
    where: { targetLang_version: { targetLang: catalog.targetLang, version: catalog.version } },
  });
  if (previous) {
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
    const prior = learningCatalogSchema.parse(revision.definition);
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
          JSON.stringify(old.skills) !== JSON.stringify(node.skills))
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
    ? learningCatalogSchema.parse(binding.revision.definition)
    : getLanguageCatalog(course.targetLang);
  if (catalog.targetLang !== course.targetLang)
    throw new Error('Course learning catalog has a different target language.');
  return {
    catalog,
    catalogHash: binding?.revision.catalogHash ?? learningCatalogHash(catalog),
    binding,
  };
}
