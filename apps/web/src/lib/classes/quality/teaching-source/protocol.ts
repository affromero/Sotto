import { z } from 'zod';
import { teachingQualityVerdictSchema } from '../teaching-failure';
import { buildReviewSourceParts } from '../source-parts/chunks';
import type { TeachingCritic, TeachingFinding } from '../teaching-review-protocol';

export type TeachingSourcePart = { index: number; fieldPath: string[]; quote: string };

/** Enumerate exact own string leaves, including individual array elements. */
export function buildTeachingSourceParts(fields: unknown): TeachingSourcePart[] {
  const parts: TeachingSourcePart[] = [];
  function visit(value: unknown, fieldPath: string[]) {
    if (typeof value === 'string') {
      if (!fieldPath.length || fieldPath.length > 6) return;
      for (const quote of buildReviewSourceParts(value, 120))
        parts.push({ index: parts.length, fieldPath: [...fieldPath], quote });
      return;
    }
    if (!value || typeof value !== 'object' || fieldPath.length >= 6) return;
    for (const key of Object.keys(value)) {
      if (
        !key.length ||
        key.length > 80 ||
        (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key))
      )
        continue;
      visit((value as Record<string, unknown>)[key], [...fieldPath, key]);
    }
  }
  visit(fields, []);
  return parts;
}

const findingSchema = z
  .object({
    sourcePartIndex: z.number().int().nonnegative(),
    issue: teachingQualityVerdictSchema.shape.items.element.shape.issues.element,
    rule: z.string().trim().min(1).max(80),
    defect: z.string().trim().min(1).max(120),
    remedy: z
      .object({
        kind: z.enum(['correction', 'counterexample']),
        text: z.string().trim().min(1).max(120),
      })
      .strict(),
  })
  .strict();

function findings(parts: readonly TeachingSourcePart[]) {
  return z
    .array(
      findingSchema.extend({
        sourcePartIndex: z.literal(parts.length ? parts.map((part) => part.index) : [0]),
      })
    )
    .max(parts.length ? 3 : 0);
}

function assertBatch(fields: readonly unknown[]) {
  if (fields.length < 1 || fields.length > 5) throw new Error('Invalid teaching review batch');
}

export function privateTeachingCriticSchema(fields: readonly unknown[]) {
  assertBatch(fields);
  return z
    .object({
      items: z
        .array(
          z.union(
            fields.map((field, index) =>
              z
                .object({
                  index: z.literal(index),
                  findings: findings(buildTeachingSourceParts(field)),
                })
                .strict()
            )
          )
        )
        .length(fields.length),
    })
    .strict();
}

export function privateTeachingAdjudicatorSchema(
  fields: readonly unknown[],
  critic: TeachingCritic
) {
  assertBatch(fields);
  return z
    .object({
      items: z
        .array(
          z.union(
            fields.map((field, index) => {
              const count = critic.items.find((item) => item.index === index)?.findings.length;
              if (count === undefined) throw new Error('Teaching critic coverage is incomplete');
              return z
                .object({
                  index: z.literal(index),
                  criticDecisions: z
                    .array(
                      z
                        .object({
                          findingIndex: z.literal(
                            count ? Array.from({ length: count }, (_, id) => id) : [0]
                          ),
                          decision: z.enum(['supported', 'dismissed']),
                          reason: z.string().trim().min(1).max(120),
                        })
                        .strict()
                    )
                    .length(count),
                  newFindings: findings(buildTeachingSourceParts(field)),
                })
                .strict();
            })
          )
        )
        .length(fields.length),
    })
    .strict();
}

export function deriveTeachingFinding(
  finding: z.infer<typeof findingSchema>,
  parts: readonly TeachingSourcePart[]
): TeachingFinding {
  const part = parts[finding.sourcePartIndex];
  if (!part || part.index !== finding.sourcePartIndex)
    throw new Error('Unknown teaching source part');
  return {
    issue: finding.issue,
    fieldPath: [...part.fieldPath],
    quote: part.quote,
    rule: finding.rule,
    defect: finding.defect,
    correction: finding.remedy.kind === 'correction' ? finding.remedy.text : null,
    counterexample: finding.remedy.kind === 'counterexample' ? finding.remedy.text : null,
  };
}

export function buildTeachingCriticJsonSchema(fields: readonly unknown[], intro = false) {
  return {
    name: intro ? 'class_intro_critic' : 'class_teaching_critic',
    schema: z.toJSONSchema(privateTeachingCriticSchema(fields), { target: 'draft-7' }),
  };
}

export function buildTeachingAdjudicatorJsonSchema(
  fields: readonly unknown[],
  critic: TeachingCritic,
  intro = false
) {
  return {
    name: intro ? 'class_intro_adjudicator' : 'class_teaching_adjudicator',
    schema: z.toJSONSchema(privateTeachingAdjudicatorSchema(fields, critic), { target: 'draft-7' }),
  };
}
