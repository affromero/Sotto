import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { SectionQualityError } from '../section-quality';
import { teachingQualityVerdictSchema, type TeachingFailure } from './teaching-failure';

/** An inconsistent or malformed review cannot guide a semantic replacement. */
export class ReviewerProtocolError extends SectionQualityError {
  readonly teachingFailure?: TeachingFailure;

  constructor(teachingFailure?: TeachingFailure) {
    super();
    this.name = 'ReviewerProtocolError';
    Object.defineProperty(this, 'teachingFailure', { value: teachingFailure, enumerable: false });
  }
}

const teachingFindingSchema = z
  .object({
    issue: teachingQualityVerdictSchema.shape.items.element.shape.issues.element,
    fieldPath: z.array(z.string().min(1).max(80)).min(1).max(6),
    quote: z.string().min(1).max(120),
    rule: z.string().trim().min(1).max(80),
    defect: z.string().trim().min(1).max(120),
    correction: z.string().trim().min(1).max(120).nullable(),
    counterexample: z.string().trim().min(1).max(120).nullable(),
  })
  .strict();

export const teachingCriticSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            index: teachingQualityVerdictSchema.shape.items.element.shape.index,
            findings: z.array(teachingFindingSchema).max(3),
          })
          .strict()
      )
      .min(1)
      .max(5),
  })
  .strict();

export const teachingAdjudicatorSchema = z
  .object({
    items: z
      .array(
        teachingQualityVerdictSchema.shape.items.element.extend({
          findings: z.array(teachingFindingSchema).max(3),
          criticDecisions: z
            .array(
              z
                .object({
                  findingIndex: z.number().int().min(0).max(2),
                  decision: z.enum(['supported', 'dismissed']),
                  reason: z.string().trim().min(1).max(120),
                })
                .strict()
            )
            .max(3),
        })
      )
      .min(1)
      .max(5),
  })
  .strict();

export type TeachingFinding = z.infer<typeof teachingFindingSchema>;
export type TeachingCritic = z.infer<typeof teachingCriticSchema>;
export type TeachingAdjudicator = z.infer<typeof teachingAdjudicatorSchema>;
export type TeachingReviewPacket = {
  offset: number;
  critic: TeachingCritic;
  adjudicator: TeachingAdjudicator;
};

function parseReview<T>(content: string, schema: z.ZodType<T>): T {
  try {
    return schema.parse(JSON.parse(content));
  } catch {
    throw new ReviewerProtocolError();
  }
}

function assertReviewCoverage(items: readonly { index: number }[], expected: number): void {
  if (
    items.length !== expected ||
    new Set(items.map(({ index }) => index)).size !== expected ||
    items.some(({ index }) => index >= expected)
  )
    throw new ReviewerProtocolError();
}

/** Bind evidence to an own string leaf of the exact assigned content. */
function assertFindingBound(finding: TeachingFinding, fields: unknown): void {
  let value = fields;
  for (const key of finding.fieldPath) {
    if (
      !value ||
      typeof value !== 'object' ||
      !Object.hasOwn(value, key) ||
      (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key))
    )
      throw new ReviewerProtocolError();
    value = (value as Record<string, unknown>)[key];
  }
  if (
    typeof value !== 'string' ||
    !finding.quote.trim() ||
    !value.includes(finding.quote) ||
    (finding.correction === null && finding.counterexample === null)
  )
    throw new ReviewerProtocolError();
}

export function parseTeachingCritic(content: string, fields: readonly unknown[]): TeachingCritic {
  const critic = parseReview(content, teachingCriticSchema);
  assertReviewCoverage(critic.items, fields.length);
  for (const row of critic.items)
    for (const finding of row.findings) assertFindingBound(finding, fields[row.index]);
  return critic;
}

export function parseTeachingAdjudicator(
  content: string,
  fields: readonly unknown[],
  critic: TeachingCritic
): TeachingAdjudicator {
  const adjudicator = parseReview(content, teachingAdjudicatorSchema);
  assertReviewCoverage(adjudicator.items, fields.length);
  for (const row of adjudicator.items) {
    const criticisms = critic.items.find(({ index }) => index === row.index)!.findings;
    assertReviewCoverage(
      row.criticDecisions.map(({ findingIndex }) => ({ index: findingIndex })),
      criticisms.length
    );
    for (const finding of row.findings) assertFindingBound(finding, fields[row.index]);
    const findingIssues = [...new Set(row.findings.map(({ issue }) => issue))].sort();
    if (
      (row.acceptable &&
        (row.findings.length > 0 || row.issues.length > 0 || row.feedback.length > 0)) ||
      (!row.acceptable &&
        (row.findings.length === 0 || row.issues.length === 0 || row.feedback.length === 0)) ||
      !isDeepStrictEqual([...new Set(row.issues)].sort(), findingIssues)
    )
      throw new ReviewerProtocolError();
    for (const decision of row.criticDecisions) {
      if (decision.decision !== 'supported') continue;
      const finding = criticisms[decision.findingIndex]!;
      if (
        row.acceptable ||
        !row.findings.some(
          (own) =>
            own.issue === finding.issue &&
            own.quote === finding.quote &&
            isDeepStrictEqual(own.fieldPath, finding.fieldPath)
        )
      )
        throw new ReviewerProtocolError();
    }
  }
  return adjudicator;
}
