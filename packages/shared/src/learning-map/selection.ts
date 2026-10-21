import { z } from 'zod';
import {
  materialMergedSourceFocusSchema,
  materialFocusAnalysisCoverageSchema,
} from '../course-materials/analysis';
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
    catalogVersion: z.number().int().positive().nullable(),
    nodeIds: z.array(z.string().min(1).max(120)).max(8),
    level: learningLevelSchema,
    materialFocusId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((selection, context) => {
    if (
      (!selection.nodeIds.length && !selection.materialFocusId) ||
      (selection.nodeIds.length > 0 && selection.catalogVersion === null)
    )
      context.addIssue({
        code: 'custom',
        message:
          'Choose an objective or an owned source focus. Canonical objectives require a catalog version.',
      });
  });
export type LearningSelectionRequest = z.infer<typeof learningSelectionRequestSchema>;

export const learningSourceFocusSnapshotSchema = z
  .object({
    id: z.string().min(1),
    analysisId: z.string().min(1),
    analysisRevision: z.number().int().positive(),
    resultDigest: z.string().regex(/^[a-f0-9]{64}$/),
    focusDigest: z.string().regex(/^[a-f0-9]{64}$/),
    detailsBase64: z
      .string()
      .min(1)
      .max(699052)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    sourceContext: z
      .string()
      .refine((text) => [...text].length <= 12000 && !text.includes('\u0000')),
    includedCitationCount: z.number().int().positive(),
    contextTruncated: z.boolean(),
    sourceScopes: z
      .array(
        z
          .object({
            subjectId: z.string().min(1),
            generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
          })
          .strict()
      )
      .min(3)
      .max(32),
    coverage: materialFocusAnalysisCoverageSchema,
  })
  .strict()
  .superRefine((focus, context) => {
    try {
      const binary = atob(focus.detailsBase64);
      if (binary.length > 524288 || btoa(binary) !== focus.detailsBase64)
        throw new Error('Noncanonical source encoding.');
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const details = materialMergedSourceFocusSchema.parse(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      );
      if (
        focus.includedCitationCount > details.citations.length ||
        focus.contextTruncated !== focus.includedCitationCount < details.citations.length
      )
        throw new Error('The source excerpt coverage changed.');
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'The frozen source focus requires complete canonical UTF-8 JSON bytes.',
      });
    }
  });
export type LearningSourceFocusSnapshot = z.infer<typeof learningSourceFocusSnapshotSchema>;

export const learningSelectionSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    catalogVersion: z.number().int().positive().nullable(),
    catalogHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    targetLang: z.string().regex(/^[a-z]{2}$/),
    level: learningLevelSchema,
    nodeIds: z.array(z.string().min(1)).max(8),
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
      .max(4),
    materialFocusId: z.string().nullable(),
    sourceFocus: learningSourceFocusSnapshotSchema.nullable().optional(),
  })
  .strict()
  .superRefine((selection, context) => {
    if (
      (selection.catalogVersion === null) !== (selection.catalogHash === null) ||
      (!selection.objectives.length && !selection.sourceFocus) ||
      ((selection.catalogVersion === null || selection.catalogHash === null) &&
        (selection.nodeIds.length > 0 ||
          selection.objectives.length > 0 ||
          !selection.sourceFocus)) ||
      selection.objectives.some((objective) => objective.level !== selection.level) ||
      selection.materialFocusId !== (selection.sourceFocus?.id ?? null)
    )
      context.addIssue({
        code: 'custom',
        message:
          'Canonical criteria require their exact catalog and difficulty. Private source-only focus requires its frozen owned source receipt.',
      });
  });
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
  if (!selection.nodeIds.length && selection.materialFocusId) return [];
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
