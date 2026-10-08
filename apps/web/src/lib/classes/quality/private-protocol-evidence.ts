import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import {
  reviewerProtocolDiagnostic,
  reviewerProtocolDiagnosticSchema,
} from './teaching-review-protocol';

const MAX_PROTOCOL_BYTES = 32 * 1024;
const payloadSchema = z
  .object({
    json: z
      .string()
      .refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_PROTOCOL_BYTES)
      .nullable(),
    byteCount: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    omitted: z.enum(['size_limit']).nullable(),
  })
  .strict()
  .refine((value) =>
    value.byteCount > MAX_PROTOCOL_BYTES
      ? value.json === null && value.omitted === 'size_limit'
      : value.json !== null &&
        value.omitted === null &&
        Buffer.byteLength(value.json, 'utf8') === value.byteCount &&
        createHash('sha256').update(value.json).digest('hex') === value.sha256
  );

const evidenceSchema = reviewerProtocolDiagnosticSchema
  .extend({
    kind: z.enum(['intro', 'explanations', 'writing', 'listening', 'speaking', 'vocabulary']),
    role: z.enum(['critic', 'adjudicator']),
    offset: z.number().int().min(0).max(49),
    payload: payloadSchema,
  })
  .strict();
export const reviewerProtocolEvidenceSchema = z.array(evidenceSchema).min(1).max(2);
type ProtocolEvidence = z.infer<typeof evidenceSchema>;
const issuedEvidence = new WeakMap<object, ProtocolEvidence>();
const retainedEvidence = new WeakMap<object, ProtocolEvidence[]>();

export function authenticReviewerProtocolEvidence(evidence: unknown): boolean {
  return (
    typeof evidence === 'object' &&
    evidence !== null &&
    isDeepStrictEqual(issuedEvidence.get(evidence), evidence)
  );
}

/** Capture one authenticated response failure without truncating learner content. */
export function captureReviewerProtocolEvidence(
  error: unknown,
  context: {
    kind: ProtocolEvidence['kind'];
    role: ProtocolEvidence['role'];
    offset: number;
    candidate: unknown;
    response: string;
  }
): ProtocolEvidence | undefined {
  const diagnostic = reviewerProtocolDiagnostic(error);
  if (!diagnostic) return undefined;
  const json = JSON.stringify({ candidate: context.candidate, response: context.response });
  const byteCount = Buffer.byteLength(json, 'utf8');
  const evidence = evidenceSchema.parse({
    ...diagnostic,
    kind: context.kind,
    role: context.role,
    offset: context.offset,
    payload: {
      json: byteCount <= MAX_PROTOCOL_BYTES ? json : null,
      byteCount,
      sha256: createHash('sha256').update(json).digest('hex'),
      omitted: byteCount > MAX_PROTOCOL_BYTES ? 'size_limit' : null,
    },
  });
  issuedEvidence.set(evidence, structuredClone(evidence));
  return evidence;
}

/** Preserve the original terminal error and only evidence issued by the canonical parser. */
export function retainReviewerProtocolEvidence(
  error: unknown,
  evidence: readonly ProtocolEvidence[]
): void {
  if ((typeof error !== 'object' || error === null) && typeof error !== 'function') return;
  const authentic = evidence.map((entry) => issuedEvidence.get(entry));
  if (!authentic.length || authentic.some((entry) => !entry)) return;
  retainedEvidence.set(error, reviewerProtocolEvidenceSchema.parse(authentic));
}

export function reviewerProtocolEvidence(error: unknown) {
  if ((typeof error !== 'object' || error === null) && typeof error !== 'function')
    return undefined;
  const evidence = retainedEvidence.get(error);
  return evidence ? structuredClone(evidence) : undefined;
}
