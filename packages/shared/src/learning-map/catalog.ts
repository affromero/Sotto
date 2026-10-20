import { z } from 'zod';
import { learningSkills } from '../learning-requirements';

export { learningSkills } from '../learning-requirements';

export const learningLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export const learningLevelSchema = z.enum(learningLevels);
export const learningSkillSchema = z.enum(learningSkills);
export const learningBranchSchema = z.enum(['GRAMMAR', 'SITUATIONS']);

const key = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9.-]*$/);
const nodeBase = z.object({
  id: key,
  parentId: key.nullable(),
  branch: learningBranchSchema,
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(2000),
  order: z.number().int().nonnegative(),
});

export const learningGroupSchema = nodeBase.extend({ kind: z.literal('GROUP') }).strict();
export const learningObjectiveSchema = nodeBase
  .extend({
    kind: z.literal('OBJECTIVE'),
    level: learningLevelSchema,
    required: z.boolean(),
    criterionVersion: z.number().int().positive(),
    policyVersion: z.literal(1),
    skills: z.array(learningSkillSchema).min(1).max(5),
    assessment: z.string().trim().min(10).max(2000),
    examples: z.array(z.string().trim().min(1).max(1000)).min(1).max(8),
    grammarKeys: z.array(z.string().trim().min(1).max(120)).max(20),
    vocabulary: z.array(z.object({ lemma: z.string().min(1), gloss: z.string() }).strict()).max(20),
  })
  .strict();
export const learningNodeSchema = z.discriminatedUnion('kind', [
  learningGroupSchema,
  learningObjectiveSchema,
]);

export const learningCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    targetLang: z.string().regex(/^[a-z]{2}$/),
    version: z.number().int().positive(),
    title: z.string().trim().min(1),
    alignment: z.literal('SOTTO_CEFR'),
    references: z.array(z.object({ title: z.string().min(1), url: z.url() }).strict()).min(1),
    nodes: z.array(learningNodeSchema).min(4).max(5000),
  })
  .strict()
  .superRefine((catalog, context) => {
    const nodes = new Map(catalog.nodes.map((node) => [node.id, node]));
    const parents = new Set(catalog.nodes.map((node) => node.parentId));
    if (nodes.size !== catalog.nodes.length)
      context.addIssue({ code: 'custom', message: 'Learning node identities must be unique.' });
    for (const branch of ['GRAMMAR', 'SITUATIONS'] as const) {
      const roots = catalog.nodes.filter(
        (node) => node.parentId === null && node.branch === branch
      );
      if (roots.length !== 1 || roots[0]?.kind !== 'GROUP')
        context.addIssue({
          code: 'custom',
          message: `Exactly one ${branch} group root is required.`,
        });
    }
    for (const [index, node] of catalog.nodes.entries()) {
      if (!node.id.startsWith(`${catalog.targetLang}.`))
        context.addIssue({
          code: 'custom',
          path: ['nodes', index, 'id'],
          message: 'Node identity must belong to the target language.',
        });
      if (node.parentId !== null) {
        const parent = nodes.get(node.parentId);
        if (!parent || parent.kind !== 'GROUP' || parent.branch !== node.branch)
          context.addIssue({
            code: 'custom',
            path: ['nodes', index, 'parentId'],
            message: 'A parent must be an existing group in the same branch.',
          });
      }
      const seen = new Set<string>([node.id]);
      let parentId = node.parentId;
      while (parentId !== null) {
        if (seen.has(parentId)) {
          context.addIssue({
            code: 'custom',
            path: ['nodes', index],
            message: 'Learning tree contains a cycle.',
          });
          break;
        }
        seen.add(parentId);
        parentId = nodes.get(parentId)?.parentId ?? null;
      }
      if (node.kind === 'GROUP' && !parents.has(node.id))
        context.addIssue({
          code: 'custom',
          path: ['nodes', index],
          message: 'Learning groups must have children.',
        });
      if (node.kind === 'OBJECTIVE' && new Set(node.skills).size !== node.skills.length)
        context.addIssue({
          code: 'custom',
          path: ['nodes', index, 'skills'],
          message: 'Skills must be unique.',
        });
    }
    for (const level of learningLevels) {
      for (const branch of ['GRAMMAR', 'SITUATIONS'] as const) {
        if (
          !catalog.nodes.some(
            (node) =>
              node.kind === 'OBJECTIVE' &&
              node.required &&
              node.level === level &&
              node.branch === branch
          )
        )
          context.addIssue({
            code: 'custom',
            message: `${level} needs required ${branch} objectives.`,
          });
      }
    }
  });

export type LearningLevel = z.infer<typeof learningLevelSchema>;
export type LearningSkill = z.infer<typeof learningSkillSchema>;
export type LearningBranch = z.infer<typeof learningBranchSchema>;
export type LearningGroup = z.infer<typeof learningGroupSchema>;
export type LearningObjective = z.infer<typeof learningObjectiveSchema>;
export type LearningNode = z.infer<typeof learningNodeSchema>;
export type LearningCatalog = z.infer<typeof learningCatalogSchema>;

export function nextLearningLevel(level: LearningLevel): LearningLevel | null {
  return learningLevels[learningLevels.indexOf(level) + 1] ?? null;
}

export function learningDescendants(catalog: LearningCatalog, nodeId: string): LearningObjective[] {
  const byId = new Map(catalog.nodes.map((node) => [node.id, node]));
  if (!byId.has(nodeId)) return [];
  return catalog.nodes.filter((node): node is LearningObjective => {
    if (node.kind !== 'OBJECTIVE') return false;
    let current: LearningNode | undefined = node;
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
      if (current.id === nodeId) return true;
      visited.add(current.id);
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
    return false;
  });
}
