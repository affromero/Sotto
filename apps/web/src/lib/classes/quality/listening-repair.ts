import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { buildListeningAudit } from './listening-audit/projection';
import { authenticTeachingFailure, type TeachingQualityRejectionError } from './teaching-quality';
import {
  teachingAdjudicatorSchema,
  teachingCriticSchema,
  type TeachingFinding,
} from './teaching-review-protocol';

export interface ListeningTeachingRepair {
  kind: 'teaching';
  findings: Array<{ index: number; findings: TeachingFinding[] }>;
}

const envelopeSchema = z
  .array(
    z
      .object({
        reviewContract: z.literal('teaching_critic_adjudicator'),
        outerVerdict: z.literal('derived_adjudicated_summary'),
        items: z.array(z.unknown()),
        listeningAudit: z
          .object({
            items: z.array(z.unknown()),
            addresses: z.array(
              z.union([
                z.object({ kind: z.literal('passage') }).strict(),
                z
                  .object({ kind: z.literal('question'), index: z.number().int().nonnegative() })
                  .strict(),
              ])
            ),
          })
          .strict()
          .optional(),
        reviewPackets: z.array(
          z
            .object({
              offset: z.number().int().min(0),
              critic: teachingCriticSchema,
              adjudicator: teachingAdjudicatorSchema,
            })
            .strict()
        ),
      })
      .strict()
  )
  .length(1);

/** Route only the unchanged, bound findings issued by the canonical teaching review. */
export function listeningRepairPlan(
  error: TeachingQualityRejectionError,
  items: readonly unknown[]
) {
  const failure = authenticTeachingFailure(error, 'listening', items);
  if (!failure || failure.reviews.length !== 1 || !failure.reviews[0].candidate) return null;
  let parsed: z.infer<typeof envelopeSchema>;
  try {
    parsed = envelopeSchema.parse(JSON.parse(failure.reviews[0].candidate));
  } catch {
    return null;
  }
  const envelope = parsed[0];
  if (!isDeepStrictEqual(envelope.items, items)) return null;
  if (envelope.listeningAudit) {
    try {
      if (!isDeepStrictEqual(envelope.listeningAudit, buildListeningAudit(items))) return null;
    } catch {
      return null;
    }
  }
  const rejected = envelope.reviewPackets.flatMap((packet) =>
    packet.adjudicator.items
      .filter((row) => !row.acceptable)
      .map((row) => ({ ...row, index: packet.offset + row.index }))
  );
  if (
    envelope.listeningAudit &&
    rejected.some((row) => !envelope.listeningAudit!.addresses[row.index])
  )
    return null;
  const mapped = rejected.map((row) => {
    const address = envelope.listeningAudit?.addresses[row.index];
    return {
      ...row,
      index: address ? (address.kind === 'passage' ? 0 : address.index) : row.index,
    };
  });
  const findings = mapped.map(({ index, findings }) => ({ index, findings }));
  if (!findings.length || findings.some((row) => !row.findings.length)) return null;
  const leaves = findings.flatMap((row) => row.findings.map((finding) => finding.fieldPath[0]));
  if (
    leaves.some((field) => !['passageText', 'question', 'options', 'explanation'].includes(field))
  )
    return null;
  return {
    target: leaves.includes('passageText') ? ('script' as const) : ('quiz' as const),
    verdict: { kind: 'teaching', findings } satisfies ListeningTeachingRepair,
    feedback: mapped.map(({ index, feedback }) => ({ index, feedback })),
    failure,
  };
}
