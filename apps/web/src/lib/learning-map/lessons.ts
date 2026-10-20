import { z } from 'zod';
import {
  learningLevelSchema,
  type LearningCatalog,
  type LearningObjective,
  type CefrLevel,
} from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import { languageCatalogAvailability } from './catalogs';
import { publishLearningCatalog } from './catalog';

const lessonMappingInput = z.object({
  level: learningLevelSchema,
  grammarPoints: z.array(z.string()),
  learningObjectiveIds: z.array(z.string().min(1)).max(8).optional(),
});
export type MappableLesson = z.infer<typeof lessonMappingInput>;

/** Curriculum links describe teaching scope. They never create learner assessment evidence. */
export function mapLessonToCatalog(catalog: LearningCatalog, input: MappableLesson) {
  const lesson = lessonMappingInput.parse(input);
  const objectives = catalog.nodes.filter(
    (node): node is LearningObjective => node.kind === 'OBJECTIVE' && node.level === lesson.level
  );
  const mappings = new Map<
    string,
    { objectiveId: string; criterionVersion: number; role: string }
  >();
  for (const id of lesson.learningObjectiveIds ?? []) {
    const objective = objectives.find((node) => node.id === id);
    if (!objective)
      throw new Error('A lesson objective must belong to its target language and difficulty.');
    mappings.set(id, {
      objectiveId: id,
      criterionVersion: objective.criterionVersion,
      role: 'EXPLICIT_GENERATION',
    });
  }
  const unresolvedGrammarKeys: string[] = [];
  for (const key of new Set(lesson.grammarPoints)) {
    const candidates = objectives.filter((objective) => objective.grammarKeys.includes(key));
    if (candidates.length !== 1) {
      unresolvedGrammarKeys.push(key);
      continue;
    }
    const objective = candidates[0]!;
    if (!mappings.has(objective.id))
      mappings.set(objective.id, {
        objectiveId: objective.id,
        criterionVersion: objective.criterionVersion,
        role: 'EXACT_GRAMMAR_KEY',
      });
  }
  return {
    objectives: [...mappings.values()],
    unresolvedGrammarKeys,
    unresolved: mappings.size === 0 || unresolvedGrammarKeys.length > 0,
  };
}

export function lessonCatalogInstructions(targetLang: string, level?: CefrLevel) {
  const availability = languageCatalogAvailability(targetLang);
  if (availability.status === 'UNAVAILABLE')
    return `The ${targetLang} learning map is unavailable. Compose the language-specific curriculum as requested, with learningObjectiveIds: [] on every lesson. No objective mapping or level mastery is implied.`;
  const { catalog } = availability;
  const objectives = catalog.nodes.filter(
    (node): node is LearningObjective =>
      node.kind === 'OBJECTIVE' && (!level || node.level === level)
  );
  return `For each lesson include learningObjectiveIds with up to eight exact IDs from this catalog at the lesson's own level. Choose only objectives the lesson actually teaches. An empty list explicitly leaves its mapping unresolved. Never invent IDs. These links express teaching scope, not demonstrated learner mastery.\n${JSON.stringify(objectives.map((node) => ({ id: node.id, level: node.level, title: node.title, assessment: node.assessment })))}`;
}

/** Publish mappings in the same transaction as a generated curriculum, or in explicit backfill work. */
export async function publishCurriculumLearningMappings(
  database: Pick<
    Prisma.TransactionClient,
    | 'curriculum'
    | 'lesson'
    | 'lessonLearningObjective'
    | 'learningMapRevision'
    | 'learningNodeIdentity'
    | '$executeRaw'
  >,
  curriculumId: string,
  targetLang: string,
  authored: readonly (MappableLesson & { slug: string })[]
) {
  if (!authored.length)
    return { status: 'PUBLISHED' as const, lessons: 0, mapped: 0, unresolved: 0 };
  const curriculum = await database.curriculum.findFirst({
    where: { id: curriculumId, targetLang },
    select: { id: true },
  });
  if (!curriculum) throw new Error('Curriculum mapping target language does not match.');
  const availability = languageCatalogAvailability(targetLang);
  if (availability.status === 'UNAVAILABLE') {
    if (authored.some((lesson) => lesson.learningObjectiveIds?.length))
      throw new Error('Objective links require a published target-language catalog.');
    return {
      status: 'UNAVAILABLE' as const,
      lessons: authored.length,
      mapped: 0,
      unresolved: authored.length,
    };
  }
  const { catalog } = availability;
  await publishLearningCatalog(database, catalog);
  const bySlug = new Map(authored.map((lesson) => [lesson.slug, lesson]));
  const lessons = await database.lesson.findMany({
    where: { curriculumId, slug: { in: [...bySlug.keys()] } },
    select: { id: true, slug: true, level: true, grammarPoints: true },
  });
  if (lessons.length !== bySlug.size)
    throw new Error('Store every authored lesson before publishing its mapping.');
  let mapped = 0;
  let unresolved = 0;
  for (const lesson of lessons) {
    const grammarPoints = z.array(z.string()).parse(lesson.grammarPoints);
    const result = mapLessonToCatalog(catalog, {
      level: lesson.level,
      grammarPoints,
      learningObjectiveIds: bySlug.get(lesson.slug)?.learningObjectiveIds,
    });
    if (result.unresolved) unresolved++;
    await database.lessonLearningObjective.deleteMany({ where: { lessonId: lesson.id } });
    for (const objective of result.objectives) {
      await database.lessonLearningObjective.upsert({
        where: {
          lessonId_objectiveId: { lessonId: lesson.id, objectiveId: objective.objectiveId },
        },
        create: { lessonId: lesson.id, ...objective },
        update: { criterionVersion: objective.criterionVersion, role: objective.role },
      });
      mapped++;
    }
  }
  return { status: 'PUBLISHED' as const, lessons: lessons.length, mapped, unresolved };
}
