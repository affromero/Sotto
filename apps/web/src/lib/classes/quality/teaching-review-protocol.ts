import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { SectionQualityError, blindReviewProtocolDiagnostic } from '../section-quality';
import { teachingQualityVerdictSchema, type TeachingFailure } from './teaching-failure';
import {
  buildTeachingSourceParts,
  deriveTeachingFinding,
  privateTeachingCriticSchema,
  privateTeachingAdjudicatorSchema,
} from './teaching-source/protocol';

/** An inconsistent or malformed review cannot guide a semantic replacement. */
export class ReviewerProtocolError extends SectionQualityError {
  readonly teachingFailure?: TeachingFailure;

  constructor(teachingFailure?: TeachingFailure) {
    super();
    this.name = 'ReviewerProtocolError';
    Object.defineProperty(this, 'teachingFailure', { value: teachingFailure, enumerable: false });
  }
}

export const reviewerProtocolDiagnosticSchema = z
  .object({
    reason: z.enum([
      'invalid_json',
      'schema',
      'coverage',
      'field_path',
      'quote_binding',
      'missing_remedy',
      'adjudicator_consistency',
      'supported_evidence',
    ]),
    pathCodes: z
      .array(
        z.enum([
          'response',
          'items',
          'criticDecisions',
          'findings.fieldPath',
          'findings.quote',
          'findings.remedy',
          'adjudicator',
        ])
      )
      .min(1)
      .max(2),
  })
  .strict();
const responseDiagnostics = new WeakMap<object, z.infer<typeof reviewerProtocolDiagnosticSchema>>();

function invalidResponse(
  reason: z.infer<typeof reviewerProtocolDiagnosticSchema>['reason'],
  path: z.infer<typeof reviewerProtocolDiagnosticSchema>['pathCodes'][number]
): ReviewerProtocolError {
  const error = new ReviewerProtocolError();
  responseDiagnostics.set(error, { reason, pathCodes: [path] });
  return error;
}

/** Only validation of a completed response can authorize protocol correction. */
export function reviewerProtocolDiagnostic(error: unknown) {
  const blind = blindReviewProtocolDiagnostic(error);
  if (blind) return reviewerProtocolDiagnosticSchema.parse(blind);
  if (!(error instanceof ReviewerProtocolError)) return undefined;
  const diagnostic = responseDiagnostics.get(error);
  return diagnostic ? structuredClone(diagnostic) : undefined;
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
          findings: z.array(teachingFindingSchema).max(6),
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
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw invalidResponse('invalid_json', 'response');
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw invalidResponse('schema', 'response');
  return parsed.data;
}

function assertReviewCoverage(
  items: readonly { index: number }[],
  expected: number,
  path: 'items' | 'criticDecisions' = 'items'
): void {
  if (
    items.length !== expected ||
    new Set(items.map(({ index }) => index)).size !== expected ||
    items.some(({ index }) => index >= expected)
  )
    throw invalidResponse('coverage', path);
}

function ownField(fields: unknown, path: readonly string[]): { value: unknown } | undefined {
  let value = fields;
  for (const key of path) {
    if (
      !value ||
      typeof value !== 'object' ||
      !Object.hasOwn(value, key) ||
      (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key))
    )
      return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return { value };
}

/** Bind evidence to an own string leaf of the exact assigned content. */
function assertFindingBound(finding: TeachingFinding, fields: unknown): void {
  if (finding.fieldPath[0] === 'content' && finding.fieldPath.length > 1) {
    const relativePath = finding.fieldPath.slice(1);
    if (fields && typeof fields === 'object' && Object.hasOwn(fields, 'content')) {
      if (
        typeof ownField(fields, finding.fieldPath)?.value === 'string' &&
        typeof ownField(fields, relativePath)?.value === 'string'
      )
        throw invalidResponse('field_path', 'findings.fieldPath');
    } else finding.fieldPath = relativePath;
  }
  assertExactFindingBound(finding, fields);
}

function assertExactFindingBound(finding: TeachingFinding, fields: unknown): void {
  const field = ownField(fields, finding.fieldPath);
  if (!field) throw invalidResponse('field_path', 'findings.fieldPath');
  const { value } = field;
  if (typeof value !== 'string' || !finding.quote.trim() || !value.includes(finding.quote))
    throw invalidResponse('quote_binding', 'findings.quote');
  if (finding.correction === null && finding.counterexample === null)
    throw invalidResponse('missing_remedy', 'findings.remedy');
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
      criticisms.length,
      'criticDecisions'
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
      throw invalidResponse('adjudicator_consistency', 'adjudicator');
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
        throw invalidResponse('supported_evidence', 'criticDecisions');
    }
  }
  return adjudicator;
}

/** Parse only the private model contract; historical evidence keeps its existing shape. */
export function parseTeachingCriticResponse(
  content: string,
  fields: readonly unknown[]
): TeachingCritic {
  const response = parseReview(content, privateTeachingCriticSchema(fields));
  assertReviewCoverage(response.items, fields.length);
  return teachingCriticSchema.parse({
    items: response.items.map((row) => ({
      index: row.index,
      findings: row.findings.map((finding) =>
        deriveTeachingFinding(finding, buildTeachingSourceParts(fields[row.index]))
      ),
    })),
  });
}

export function parseTeachingAdjudicatorResponse(
  content: string,
  fields: readonly unknown[],
  critic: TeachingCritic
): TeachingAdjudicator {
  const validatedCritic = parseReview(JSON.stringify(critic), teachingCriticSchema);
  assertReviewCoverage(validatedCritic.items, fields.length);
  for (const row of validatedCritic.items)
    for (const finding of row.findings) assertExactFindingBound(finding, fields[row.index]);
  const response = parseReview(content, privateTeachingAdjudicatorSchema(fields, validatedCritic));
  assertReviewCoverage(response.items, fields.length);
  return teachingAdjudicatorSchema.parse({
    items: response.items.map((row) => {
      const criticisms = validatedCritic.items.find((item) => item.index === row.index)!.findings;
      assertReviewCoverage(
        row.criticDecisions.map((decision) => ({ index: decision.findingIndex })),
        criticisms.length,
        'criticDecisions'
      );
      const findings = [
        ...row.criticDecisions
          .filter((decision) => decision.decision === 'supported')
          .map((decision) => structuredClone(criticisms[decision.findingIndex]!)),
        ...row.newFindings.map((finding) =>
          deriveTeachingFinding(finding, buildTeachingSourceParts(fields[row.index]))
        ),
      ];
      return {
        index: row.index,
        acceptable: findings.length === 0,
        issues: [...new Set(findings.map((finding) => finding.issue))],
        feedback: findings.map(
          (finding) =>
            `${finding.defect} ${finding.correction !== null ? 'Correction' : 'Counterexample'}: ${finding.correction ?? finding.counterexample}`
        ),
        findings,
        criticDecisions: row.criticDecisions,
      };
    }),
  });
}
