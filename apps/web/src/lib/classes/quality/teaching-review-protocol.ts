import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { SectionQualityError, blindReviewProtocolDiagnostic } from '../section-quality';
import { teachingQualityVerdictSchema, type TeachingFailure } from './teaching-failure';
import {
  readingAnswerSupportEvidenceSchema,
  parseReadingAnswerSupport,
  readingAnswerSupportFailure,
} from './teaching-source/reading-answer-support';
import {
  listeningPassageExtractionEvidenceSchema,
  listeningPassageWitnessEvidenceSchema,
  parseListeningPassageExtraction,
  parseListeningPassageExtractionResponse,
  parseListeningPassageWitness,
  parseListeningPassageWitnessResponse,
  listeningPassageWitnessFailure,
  supportedMeaningDifferenceRule,
} from './listening-audit/passage-witness';
import type { NormalizedListeningTurn } from './listening-audit/projection';
import {
  buildTeachingSourceParts,
  deriveTeachingFinding,
  privateTeachingCriticSchema,
  privateTeachingAdjudicatorSchema,
  passageConcernDecisionSchema,
  resolveTeachingCriticAssignment,
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

const schemaIssueSchema = z
  .object({
    path: z
      .array(
        z.union([
          z.enum(['items', 'passageWitness', 'pairDecisions', 'additionalPairs', 'status']),
          z.number().int().nonnegative(),
        ])
      )
      .min(1)
      .max(6),
    rule: z.literal(supportedMeaningDifferenceRule),
  })
  .strict();

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
    schemaIssues: z.array(schemaIssueSchema).min(1).max(6).optional(),
  })
  .strict();
const responseDiagnostics = new WeakMap<object, z.infer<typeof reviewerProtocolDiagnosticSchema>>();

function invalidResponse(
  reason: z.infer<typeof reviewerProtocolDiagnosticSchema>['reason'],
  path: z.infer<typeof reviewerProtocolDiagnosticSchema>['pathCodes'][number],
  schemaIssues?: z.infer<typeof schemaIssueSchema>[]
): ReviewerProtocolError {
  const error = new ReviewerProtocolError();
  responseDiagnostics.set(error, {
    reason,
    pathCodes: [path],
    ...(schemaIssues?.length ? { schemaIssues } : {}),
  });
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
            answerSupport: readingAnswerSupportEvidenceSchema.optional(),
            passageWitness: listeningPassageExtractionEvidenceSchema.optional(),
          })
          .strict()
      )
      .min(1)
      .max(5),
  })
  .strict();

export const teachingAdjudicatorSchema = z
  .object({
    passageConcernDecisions: z.array(passageConcernDecisionSchema).max(3).optional(),
    items: z
      .array(
        teachingQualityVerdictSchema.shape.items.element.extend({
          findings: z.array(teachingFindingSchema).max(6),
          answerSupport: readingAnswerSupportEvidenceSchema.optional(),
          passageWitness: listeningPassageWitnessEvidenceSchema.optional(),
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
  criticAssignment?: readonly number[];
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
  if (!parsed.success) {
    const schemaIssues: z.infer<typeof schemaIssueSchema>[] = [];
    function collect(issues: z.ZodError['issues']) {
      for (const issue of issues) {
        if (schemaIssues.length === 6) return;
        if (issue.code === 'invalid_union') {
          issue.errors.forEach(collect);
          continue;
        }
        if (issue.code !== 'custom' || issue.message !== supportedMeaningDifferenceRule) continue;
        const detail = schemaIssueSchema.safeParse({ path: issue.path, rule: issue.message });
        if (
          detail.success &&
          !schemaIssues.some((existing) => isDeepStrictEqual(existing, detail.data))
        )
          schemaIssues.push(detail.data);
      }
    }
    collect(parsed.error.issues);
    throw invalidResponse('schema', 'response', schemaIssues);
  }
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

function assertCriticCoverage(
  items: readonly { index: number }[],
  fields: readonly unknown[],
  reading: boolean,
  listeningTurns?: readonly NormalizedListeningTurn[],
  criticAssignment?: readonly number[]
) {
  let assigned: number[];
  try {
    assigned = resolveTeachingCriticAssignment(fields, reading, listeningTurns, criticAssignment);
  } catch {
    throw invalidResponse('coverage', 'items');
  }
  if (
    items.length !== assigned.length ||
    new Set(items.map(({ index }) => index)).size !== assigned.length ||
    items.some(({ index }) => !assigned.includes(index))
  )
    throw invalidResponse('coverage', 'items');
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

export function parseTeachingCritic(
  content: string,
  fields: readonly unknown[],
  listeningTurns?: readonly NormalizedListeningTurn[],
  criticAssignment?: readonly number[]
): TeachingCritic {
  const critic = parseReview(content, teachingCriticSchema);
  assertCriticCoverage(critic.items, fields, false, listeningTurns, criticAssignment);
  for (const row of critic.items) {
    if (row.answerSupport) validatedAnswerSupport(row.answerSupport, fields[row.index]);
    if (row.passageWitness)
      validatedPassageExtraction(row.passageWitness, fields[row.index], row.index, listeningTurns);
    for (const finding of row.findings) assertFindingBound(finding, fields[row.index]);
  }
  return critic;
}

export function parseTeachingAdjudicator(
  content: string,
  fields: readonly unknown[],
  critic: TeachingCritic,
  listeningTurns?: readonly NormalizedListeningTurn[],
  criticAssignment?: readonly number[]
): TeachingAdjudicator {
  assertCriticCoverage(critic.items, fields, false, listeningTurns, criticAssignment);
  for (const row of critic.items)
    if (row.passageWitness)
      validatedPassageExtraction(row.passageWitness, fields[row.index], row.index, listeningTurns);
  const adjudicator = parseReview(content, teachingAdjudicatorSchema);
  assertReviewCoverage(adjudicator.items, fields.length);
  for (const row of adjudicator.items) {
    const criticisms = critic.items.find(({ index }) => index === row.index)?.findings ?? [];
    assertReviewCoverage(
      row.criticDecisions.map(({ findingIndex }) => ({ index: findingIndex })),
      criticisms.length,
      'criticDecisions'
    );
    for (const finding of row.findings) assertFindingBound(finding, fields[row.index]);
    const supportFailure = row.answerSupport
      ? readingAnswerSupportFailure(
          validatedAnswerSupport(row.answerSupport, fields[row.index]),
          (fields[row.index] as { correctIndex: number }).correctIndex
        )
      : undefined;
    const passageFailure = row.passageWitness
      ? listeningPassageWitnessFailure(
          validatedPassageWitness(
            row.passageWitness,
            fields[row.index],
            row.index,
            listeningTurns,
            critic.items.find((item) => item.index === row.index)?.passageWitness
          )
        )
      : undefined;
    const findingIssues = [
      ...new Set([
        ...row.findings.map(({ issue }) => issue),
        ...(supportFailure ? ['unsupported'] : []),
        ...(passageFailure ? [passageFailure.issue] : []),
      ]),
    ].sort();
    if (
      (row.acceptable &&
        (row.findings.length > 0 ||
          supportFailure ||
          passageFailure ||
          row.issues.length > 0 ||
          row.feedback.length > 0)) ||
      (!row.acceptable &&
        ((!row.findings.length && !supportFailure && !passageFailure) ||
          row.issues.length === 0 ||
          row.feedback.length === 0)) ||
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

function validatedAnswerSupport(value: unknown, fields: unknown) {
  try {
    return parseReadingAnswerSupport(value, fields);
  } catch {
    throw invalidResponse('supported_evidence', 'adjudicator');
  }
}

function validatedPassageExtraction(
  value: unknown,
  fields: unknown,
  index: number,
  listeningTurns?: readonly NormalizedListeningTurn[]
) {
  if (index !== 0 || !listeningTurns) throw invalidResponse('supported_evidence', 'adjudicator');
  try {
    return parseListeningPassageExtraction(value, fields, listeningTurns);
  } catch {
    throw invalidResponse('supported_evidence', 'adjudicator');
  }
}

function validatedPassageWitness(
  value: unknown,
  fields: unknown,
  index: number,
  listeningTurns: readonly NormalizedListeningTurn[] | undefined,
  extraction: TeachingCritic['items'][number]['passageWitness']
) {
  if (index !== 0 || !listeningTurns || !extraction)
    throw invalidResponse('supported_evidence', 'adjudicator');
  try {
    return parseListeningPassageWitness(value, fields, listeningTurns, extraction);
  } catch {
    throw invalidResponse('supported_evidence', 'adjudicator');
  }
}

function validatedPassageExtractionResponse(
  value: unknown,
  fields: unknown,
  index: number,
  listeningTurns: readonly NormalizedListeningTurn[] | undefined,
  listeningTargetLang: string | undefined
) {
  if (index !== 0 || !listeningTurns) throw invalidResponse('supported_evidence', 'adjudicator');
  try {
    return parseListeningPassageExtractionResponse(
      value,
      fields,
      listeningTurns,
      listeningTargetLang!
    );
  } catch {
    throw invalidResponse('supported_evidence', 'adjudicator');
  }
}

function validatedPassageWitnessResponse(
  value: unknown,
  fields: unknown,
  index: number,
  listeningTurns: readonly NormalizedListeningTurn[] | undefined,
  extraction: TeachingCritic['items'][number]['passageWitness'],
  listeningTargetLang: string | undefined
) {
  if (index !== 0 || !listeningTurns || !extraction)
    throw invalidResponse('supported_evidence', 'adjudicator');
  try {
    return parseListeningPassageWitnessResponse(
      value,
      fields,
      listeningTurns,
      extraction,
      listeningTargetLang!
    );
  } catch {
    throw invalidResponse('supported_evidence', 'adjudicator');
  }
}

/** Parse only the private model contract; historical evidence keeps its existing shape. */
export function parseTeachingCriticResponse(
  content: string,
  fields: readonly unknown[],
  reading = false,
  listeningTurns?: readonly NormalizedListeningTurn[],
  criticAssignment?: readonly number[],
  listeningTargetLang?: string
): TeachingCritic {
  const response = parseReview(
    content,
    privateTeachingCriticSchema(
      fields,
      reading,
      listeningTurns,
      criticAssignment,
      listeningTargetLang
    )
  );
  assertCriticCoverage(response.items, fields, reading, listeningTurns, criticAssignment);
  return teachingCriticSchema.parse({
    items: response.items.map((row) => ({
      index: row.index,
      ...(reading
        ? { answerSupport: validatedAnswerSupport(row.answerSupport, fields[row.index]) }
        : {}),
      ...(listeningTurns && row.index === 0
        ? {
            passageWitness: validatedPassageExtractionResponse(
              row.passageWitness,
              fields[row.index],
              row.index,
              listeningTurns,
              listeningTargetLang
            ),
          }
        : {}),
      findings: row.findings.map((finding) =>
        deriveTeachingFinding(finding, buildTeachingSourceParts(fields[row.index]))
      ),
    })),
  });
}

export function parseTeachingAdjudicatorResponse(
  content: string,
  fields: readonly unknown[],
  critic: TeachingCritic,
  passageConcernCount = 0,
  reading = false,
  listeningTurns?: readonly NormalizedListeningTurn[],
  criticAssignment?: readonly number[],
  listeningTargetLang?: string
): TeachingAdjudicator {
  const validatedCritic = parseReview(JSON.stringify(critic), teachingCriticSchema);
  assertCriticCoverage(validatedCritic.items, fields, reading, listeningTurns, criticAssignment);
  for (const row of validatedCritic.items) {
    if (reading) validatedAnswerSupport(row.answerSupport, fields[row.index]);
    if (row.passageWitness)
      validatedPassageExtraction(row.passageWitness, fields[row.index], row.index, listeningTurns);
    for (const finding of row.findings) assertExactFindingBound(finding, fields[row.index]);
  }
  const response = parseReview(
    content,
    privateTeachingAdjudicatorSchema(
      fields,
      validatedCritic,
      passageConcernCount,
      reading,
      listeningTurns,
      criticAssignment,
      listeningTargetLang
    )
  );
  assertReviewCoverage(response.items, fields.length);
  const adjudicator = teachingAdjudicatorSchema.parse({
    ...(response.passageConcernDecisions
      ? { passageConcernDecisions: response.passageConcernDecisions }
      : {}),
    items: response.items.map((row) => {
      const criticisms =
        validatedCritic.items.find((item) => item.index === row.index)?.findings ?? [];
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
      const answerSupport = reading
        ? validatedAnswerSupport(row.answerSupport, fields[row.index])
        : undefined;
      const supportFailure = answerSupport
        ? readingAnswerSupportFailure(
            answerSupport,
            (fields[row.index] as { correctIndex: number }).correctIndex
          )
        : undefined;
      const passageWitness =
        listeningTurns && row.index === 0
          ? validatedPassageWitnessResponse(
              row.passageWitness,
              fields[row.index],
              row.index,
              listeningTurns,
              validatedCritic.items.find((item) => item.index === row.index)?.passageWitness,
              listeningTargetLang
            )
          : undefined;
      const passageFailure = passageWitness
        ? listeningPassageWitnessFailure(passageWitness)
        : undefined;
      return {
        index: row.index,
        ...(answerSupport ? { answerSupport } : {}),
        ...(passageWitness ? { passageWitness } : {}),
        acceptable: findings.length === 0 && !supportFailure && !passageFailure,
        issues: [
          ...new Set([
            ...findings.map((finding) => finding.issue),
            ...(supportFailure ? ['unsupported' as const] : []),
            ...(passageFailure ? [passageFailure.issue] : []),
          ]),
        ],
        feedback: [
          ...findings.map(
            (finding) =>
              `${finding.defect} ${finding.correction !== null ? 'Correction' : 'Counterexample'}: ${finding.correction ?? finding.counterexample}`
          ),
          ...(supportFailure ? [supportFailure] : []),
          ...(passageFailure ? [passageFailure.feedback] : []),
        ],
        findings,
        criticDecisions: row.criticDecisions,
      };
    }),
  });
  if (passageConcernCount) {
    const decisions = adjudicator.passageConcernDecisions;
    if (
      !decisions ||
      decisions.length !== passageConcernCount ||
      new Set(decisions.map((decision) => decision.concernIndex)).size !== passageConcernCount ||
      decisions.some((decision) => decision.concernIndex >= passageConcernCount)
    )
      throw invalidResponse('coverage', 'adjudicator');
    for (const decision of decisions) {
      if (decision.decision === 'dismissed') continue;
      const finding = adjudicator.items.find((item) => item.index === decision.itemIndex)?.findings[
        decision.findingIndex
      ];
      if (!finding || finding.fieldPath[0] !== 'passageText')
        throw invalidResponse('supported_evidence', 'adjudicator');
    }
  }
  return adjudicator;
}
