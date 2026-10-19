import { z } from 'zod';
import { teachingQualityVerdictSchema } from '../teaching-failure';
import { buildReviewSourceParts } from '../source-parts/chunks';
import type { TeachingCritic, TeachingFinding } from '../teaching-review-protocol';
import { readingAnswerSupportSchema } from './reading-answer-support';
import {
  listeningPassageExtractionSchema,
  listeningPassageExtractionResponseSchema,
  listeningPassageWitnessResponseSchema,
} from '../listening-audit/passage-witness';
import { buildListeningAudit, type NormalizedListeningTurn } from '../listening-audit/projection';
import {
  buildListeningSourceUnits,
  retainListeningSourceBinding,
} from '../listening-audit/source-units';
import {
  listeningNarrativeExtractionResponseSchema,
  listeningNarrativeWitnessResponseSchema,
} from '../listening-audit/narrative-witness';

export type TeachingSourcePart = { index: number; fieldPath: string[]; quote: string };

export const vocabularyWordingEvidenceSchema = z.union([
  z
    .object({
      kind: z.literal('language_constraint'),
      constraint: z.string().trim().min(1).max(120),
      violation: z.string().trim().min(1).max(120),
    })
    .strict(),
  z
    .object({
      kind: z.literal('unresolved_meaning'),
      competingReading: z.string().trim().min(1).max(120),
      contextGap: z.string().trim().min(1).max(120),
    })
    .strict(),
]);

export const passageConcernDecisionSchema = z.union([
  z
    .object({
      concernIndex: z.number().int().nonnegative().max(2),
      decision: z.literal('dismissed'),
      reason: z.string().trim().min(1).max(120),
    })
    .strict(),
  z
    .object({
      concernIndex: z.number().int().nonnegative().max(2),
      decision: z.literal('supported'),
      reason: z.string().trim().min(1).max(120),
      itemIndex: z.number().int().min(0).max(4),
      findingIndex: z.number().int().min(0).max(5),
    })
    .strict(),
]);

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

function findings(parts: readonly TeachingSourcePart[], vocabularyRecall = false) {
  const bound = findingSchema.extend({
    sourcePartIndex: z.literal(parts.length ? parts.map((part) => part.index) : [0]),
  });
  const schema = vocabularyRecall
    ? z.union([
        bound.extend({ issue: findingSchema.shape.issue.exclude(['unnatural']) }),
        bound.extend({
          issue: z.literal('unnatural'),
          wordingEvidence: vocabularyWordingEvidenceSchema,
        }),
      ])
    : bound;
  return z.array(schema).max(parts.length ? 3 : 0);
}

function criticDecisions(criticFindings: readonly TeachingFinding[], vocabularyRecall: boolean) {
  const decision = z
    .object({
      findingIndex: z.literal(
        criticFindings.length ? criticFindings.map((_, index) => index) : [0]
      ),
      decision: z.enum(['supported', 'dismissed']),
      reason: z.string().trim().min(1).max(120),
    })
    .strict();
  if (!vocabularyRecall || !criticFindings.length)
    return z.array(decision).length(criticFindings.length);
  return z
    .array(
      z.union(
        criticFindings.map((finding, index) => {
          const bound = decision.extend({ findingIndex: z.literal(index) });
          return finding.issue === 'unnatural'
            ? z.union([
                bound.extend({ decision: z.literal('dismissed') }),
                bound.extend({
                  decision: z.literal('supported'),
                  wordingEvidence: vocabularyWordingEvidenceSchema,
                }),
              ])
            : bound;
        })
      )
    )
    .length(criticFindings.length);
}

function assertBatch(fields: readonly unknown[]) {
  if (fields.length < 1 || fields.length > 5) throw new Error('Invalid teaching review batch');
}

/** Only canonical listening passage review may narrow the critic's assigned indices. */
export function resolveTeachingCriticAssignment(
  fields: readonly unknown[],
  reading = false,
  listeningTurns?: readonly NormalizedListeningTurn[],
  criticAssignment?: readonly number[]
): number[] {
  assertBatch(fields);
  const all = fields.map((_, index) => index);
  if (criticAssignment === undefined) return all;
  if (
    criticAssignment.length === all.length &&
    criticAssignment.every((index, i) => index === all[i])
  )
    return all;
  if (reading || !listeningTurns || criticAssignment.length !== 1 || criticAssignment[0] !== 0)
    throw new Error('Invalid teaching critic assignment');
  buildListeningAudit([fields[0]], listeningTurns);
  return [0];
}

export function privateTeachingCriticSchema(
  fields: readonly unknown[],
  reading = false,
  listeningTurns?: readonly NormalizedListeningTurn[],
  criticAssignment?: readonly number[],
  listeningTargetLang?: string
) {
  assertBatch(fields);
  if (reading && listeningTurns) throw new Error('Reading cannot use a listening witness');
  const assigned = resolveTeachingCriticAssignment(
    fields,
    reading,
    listeningTurns,
    criticAssignment
  );
  return z
    .object({
      items: z
        .array(
          z.union(
            assigned.map((index) =>
              z
                .object({
                  index: z.literal(index),
                  ...(reading ? { answerSupport: readingAnswerSupportSchema(fields[index]) } : {}),
                  ...(listeningTurns && index === 0
                    ? {
                        narrativeWitness: listeningNarrativeExtractionResponseSchema(
                          fields[index],
                          listeningTurns,
                          retainListeningSourceBinding(
                            buildListeningSourceUnits(
                              fields[index],
                              listeningTurns,
                              listeningTargetLang!
                            )
                          )
                        ),
                        passageWitness: listeningPassageExtractionResponseSchema(
                          fields[index],
                          listeningTurns,
                          listeningTargetLang!
                        ),
                      }
                    : {}),
                  findings: findings(buildTeachingSourceParts(fields[index])),
                })
                .strict()
            )
          )
        )
        .length(assigned.length),
    })
    .strict();
}

export function privateTeachingAdjudicatorSchema(
  fields: readonly unknown[],
  critic: TeachingCritic,
  passageConcernCount = 0,
  reading = false,
  listeningTurns?: readonly NormalizedListeningTurn[],
  criticAssignment?: readonly number[],
  listeningTargetLang?: string,
  vocabularyRecall = false
) {
  assertBatch(fields);
  if (reading && listeningTurns) throw new Error('Reading cannot use a listening witness');
  if (vocabularyRecall && (reading || listeningTurns))
    throw new Error('Vocabulary recall cannot use another skill audit');
  const assigned = resolveTeachingCriticAssignment(
    fields,
    reading,
    listeningTurns,
    criticAssignment
  );
  if (
    critic.items.length !== assigned.length ||
    new Set(critic.items.map(({ index }) => index)).size !== assigned.length ||
    critic.items.some(({ index }) => !assigned.includes(index))
  )
    throw new Error('Teaching critic coverage is incomplete');
  if (listeningTurns)
    listeningPassageExtractionSchema(fields[0], listeningTurns).parse(
      critic.items.find((item) => item.index === 0)?.passageWitness
    );
  if (!Number.isInteger(passageConcernCount) || passageConcernCount < 0 || passageConcernCount > 3)
    throw new Error('Invalid passage concern count');
  return z
    .object({
      ...(passageConcernCount
        ? {
            passageConcernDecisions: z
              .array(passageConcernDecisionSchema)
              .length(passageConcernCount),
          }
        : {}),
      items: z
        .array(
          z.union(
            fields.map((field, index) => {
              const criticFindings = assigned.includes(index)
                ? critic.items.find((item) => item.index === index)?.findings
                : [];
              if (!criticFindings) throw new Error('Teaching critic coverage is incomplete');
              return z
                .object({
                  index: z.literal(index),
                  ...(reading ? { answerSupport: readingAnswerSupportSchema(field) } : {}),
                  ...(listeningTurns && index === 0
                    ? {
                        narrativeWitness: listeningNarrativeWitnessResponseSchema(
                          field,
                          listeningTurns,
                          critic.items.find((item) => item.index === 0)!.narrativeWitness!
                        ),
                        passageWitness: listeningPassageWitnessResponseSchema(
                          field,
                          listeningTurns,
                          critic.items.find((item) => item.index === 0)!.passageWitness!,
                          listeningTargetLang!
                        ),
                      }
                    : {}),
                  criticDecisions: criticDecisions(criticFindings, vocabularyRecall),
                  newFindings: findings(buildTeachingSourceParts(field), vocabularyRecall),
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
  finding: z.infer<typeof findingSchema> & {
    wordingEvidence?: z.infer<typeof vocabularyWordingEvidenceSchema>;
  },
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
    ...(finding.wordingEvidence ? { wordingEvidence: finding.wordingEvidence } : {}),
  };
}

export function buildTeachingCriticJsonSchema(
  fields: readonly unknown[],
  intro = false,
  reading = false,
  listeningTurns?: readonly NormalizedListeningTurn[],
  criticAssignment?: readonly number[],
  listeningTargetLang?: string
) {
  if (intro && listeningTurns) throw new Error('Intro cannot use a listening witness');
  return {
    name: intro ? 'class_intro_critic' : 'class_teaching_critic',
    schema: z.toJSONSchema(
      privateTeachingCriticSchema(
        fields,
        reading,
        listeningTurns,
        criticAssignment,
        listeningTargetLang
      ),
      {
        target: 'draft-7',
      }
    ),
  };
}

export function buildTeachingAdjudicatorJsonSchema(
  fields: readonly unknown[],
  critic: TeachingCritic,
  intro = false,
  passageConcernCount = 0,
  reading = false,
  listeningTurns?: readonly NormalizedListeningTurn[],
  criticAssignment?: readonly number[],
  listeningTargetLang?: string,
  vocabularyRecall = false
) {
  if (intro && listeningTurns) throw new Error('Intro cannot use a listening witness');
  if (intro && vocabularyRecall) throw new Error('Intro cannot use vocabulary recall');
  return {
    name: intro ? 'class_intro_adjudicator' : 'class_teaching_adjudicator',
    schema: z.toJSONSchema(
      privateTeachingAdjudicatorSchema(
        fields,
        critic,
        passageConcernCount,
        reading,
        listeningTurns,
        criticAssignment,
        listeningTargetLang,
        vocabularyRecall
      ),
      {
        target: 'draft-7',
      }
    ),
  };
}
