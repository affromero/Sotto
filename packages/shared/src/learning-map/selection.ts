import { z } from 'zod';
import {
  learningLevelSchema,
  learningSkillSchema,
  learningSkillCriteriaSchema,
  validateLearningSkillCriteria,
  type LearningCatalog,
  type LearningObjective,
  learningDescendants,
} from './catalog';

export const learningSelectionRequestSchema = z
  .object({
    catalogVersion: z.number().int().positive(),
    nodeIds: z.array(z.string().min(1).max(120)).min(1).max(8),
    level: learningLevelSchema,
    materialFocusId: z.string().min(1).optional(),
  })
  .strict();
export type LearningSelectionRequest = z.infer<typeof learningSelectionRequestSchema>;

export const learningSelectionSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    catalogVersion: z.number().int().positive(),
    catalogHash: z.string().regex(/^[a-f0-9]{64}$/),
    targetLang: z.string().regex(/^[a-z]{2}$/),
    level: learningLevelSchema,
    nodeIds: z.array(z.string().min(1)).min(1).max(8),
    objectives: z
      .array(
        z
          .object({
            id: z.string().min(1),
            criterionVersion: z.number().int().positive(),
            policyVersion: z.number().int().positive(),
            title: z.string().min(1),
            branch: z.enum(['GRAMMAR', 'SITUATIONS']),
            level: learningLevelSchema,
            assessment: z.string().min(1),
            examples: z.array(z.string().min(1)).min(1),
            skills: z.array(learningSkillSchema).min(1).max(5),
            skillCriteria: learningSkillCriteriaSchema,
            grammarKeys: z.array(z.string()),
            vocabulary: z.array(z.object({ lemma: z.string(), gloss: z.string() }).strict()),
          })
          .strict()
          .superRefine(validateLearningSkillCriteria)
      )
      .min(1)
      .max(4),
    materialFocusId: z.string().nullable(),
  })
  .strict();
export type LearningSelectionSnapshot = z.infer<typeof learningSelectionSnapshotSchema>;

export function normalizeLearningSelection(
  input: LearningSelectionRequest
): LearningSelectionRequest {
  const selection = learningSelectionRequestSchema.parse(input);
  return { ...selection, nodeIds: [...new Set(selection.nodeIds)].sort() };
}

export function resolveLearningSelection(
  catalog: LearningCatalog,
  request: LearningSelectionRequest,
  priorityObjectiveIds: readonly string[] = []
): LearningObjective[] {
  const selection = normalizeLearningSelection(request);
  if (selection.catalogVersion !== catalog.version)
    throw new Error('The learning catalog changed. Reload your selection.');
  const objectives = new Map<string, LearningObjective>();
  const explicit = new Set<string>();
  for (const nodeId of selection.nodeIds) {
    const node = catalog.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) throw new Error('A selected learning objective does not belong to this language.');
    if (node.kind === 'OBJECTIVE') explicit.add(node.id);
    const descendants = learningDescendants(catalog, nodeId).filter(
      (objective) => objective.level === selection.level
    );
    if (!descendants.length)
      throw new Error('This selection has no objectives at the selected level.');
    for (const objective of descendants) objectives.set(objective.id, objective);
  }
  if (explicit.size > 4) throw new Error('Choose at most four specific objectives for one class.');
  const priority = new Map(priorityObjectiveIds.map((id, index) => [id, index]));
  const ranked = [...objectives.values()].sort(
    (left, right) =>
      Number(explicit.has(right.id)) - Number(explicit.has(left.id)) ||
      (priority.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (priority.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
      left.order - right.order ||
      left.id.localeCompare(right.id)
  );
  const chosen = new Map(
    ranked
      .filter((objective) => explicit.has(objective.id))
      .map((objective) => [objective.id, objective])
  );
  for (const nodeId of selection.nodeIds) {
    const descendants = new Set(
      learningDescendants(catalog, nodeId).map((objective) => objective.id)
    );
    if ([...chosen.keys()].some((id) => descendants.has(id))) continue;
    const candidate = ranked.find((objective) => descendants.has(objective.id));
    if (!candidate || chosen.size >= 4) throw new Error('Choose fewer groups for one class.');
    chosen.set(candidate.id, candidate);
  }
  for (const objective of ranked) {
    if (chosen.size >= 4) break;
    chosen.set(objective.id, objective);
  }
  return [...chosen.values()];
}
