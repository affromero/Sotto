import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { sectionReviewFeedbackSchema } from '../section-quality';
import {
  buildListeningAudit,
  normalizedListeningTurnSchema,
  type NormalizedListeningTurn,
} from './listening-audit/projection';
import {
  listeningPassageWitnessRepairFindings,
  listeningPassageWitnessRepairTurnIndices,
} from './listening-audit/passage-witness';
import { listeningSourcePartTurnIndices } from './listening-audit/source-units';
import {
  authenticListeningTeachingReview,
  type TeachingQualityRejectionError,
} from './teaching-quality';
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
        listeningPassageReview: sectionReviewFeedbackSchema.optional(),
        listeningSource: z.string().optional(),
        listeningAudit: z
          .object({
            turns: z.array(normalizedListeningTurnSchema).min(1).optional(),
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
              criticAssignment: z.tuple([z.literal(0)]).optional(),
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
  items: readonly unknown[],
  listeningSource?: string,
  listeningTurns?: readonly NormalizedListeningTurn[]
) {
  const review = authenticListeningTeachingReview(error, items);
  if (!review || review.failure.reviews.length !== 1) return null;
  const { failure } = review;
  let parsed: z.infer<typeof envelopeSchema>;
  try {
    parsed = envelopeSchema.parse(review.candidate);
  } catch {
    return null;
  }
  const envelope = parsed[0];
  if (
    envelope.reviewPackets.some(
      (packet) => packet.criticAssignment && !envelope.listeningAudit?.turns
    )
  )
    return null;
  if (envelope.listeningSource !== listeningSource) return null;
  if (!isDeepStrictEqual(envelope.items, items)) return null;
  if (envelope.listeningAudit) {
    try {
      if (!isDeepStrictEqual(envelope.listeningAudit, buildListeningAudit(items, listeningTurns)))
        return null;
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
  const findings: ListeningTeachingRepair['findings'] = [];
  const turnIndices = new Set<number>();
  try {
    for (const row of mapped) {
      const turns = envelope.listeningAudit?.turns;
      const passageFindings = row.findings.filter(
        (finding) => finding.fieldPath.length === 1 && finding.fieldPath[0] === 'passageText'
      );
      if (passageFindings.length) {
        if (!turns) return null;
        for (const index of listeningSourcePartTurnIndices(
          envelope.listeningAudit!.items[0],
          turns,
          passageFindings.map((finding) => finding.quote)
        ))
          turnIndices.add(index);
      }
      if (row.passageWitness && !turns) return null;
      const witnessFindings = row.passageWitness
        ? listeningPassageWitnessRepairFindings(
            row.passageWitness,
            envelope.listeningAudit!.items[0],
            turns!
          )
        : [];
      if (row.passageWitness)
        for (const index of listeningPassageWitnessRepairTurnIndices(
          row.passageWitness,
          envelope.listeningAudit!.items[0],
          turns!
        ))
          turnIndices.add(index);
      findings.push({ index: row.index, findings: [...row.findings, ...witnessFindings] });
    }
  } catch {
    return null;
  }
  if (!findings.length || findings.some((row) => !row.findings.length)) return null;
  const leaves = findings.flatMap((row) => row.findings.map((finding) => finding.fieldPath[0]));
  if (
    leaves.some((field) => !['passageText', 'question', 'options', 'explanation'].includes(field))
  )
    return null;
  const script = leaves.includes('passageText');
  if (script && !turnIndices.size) return null;
  return {
    target: script ? ('script' as const) : ('quiz' as const),
    ...(script
      ? {
          turnRepair: {
            turnIndices: [...turnIndices].sort((left, right) => left - right),
            turns: envelope.listeningAudit!.turns!,
          },
        }
      : {}),
    verdict: { kind: 'teaching', findings } satisfies ListeningTeachingRepair,
    feedback: mapped.map(({ index, feedback }) => ({ index, feedback })),
    failure,
  };
}
