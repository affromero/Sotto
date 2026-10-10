import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { TeachingFinding } from '../teaching-review-protocol';
import { buildTeachingSourceParts, deriveTeachingFinding } from '../teaching-source/protocol';
import type { NormalizedListeningTurn } from './projection';
import {
  buildListeningSourceUnits,
  listeningSourceBindingShape,
  retainListeningSourceBinding,
  validateListeningSourceBinding,
  type ListeningSourceBinding,
  type ListeningSourceTable,
} from './source-units';

export { buildListeningSourceUnits } from './source-units';
export type { ListeningSourceTable } from './source-units';

const relationBudgetPerTurn = 6;
export const supportedMeaningDifferenceRule =
  'An illustration or claimed_equivalence with a different meaning check cannot have supported or explicitly_repaired status.';
export const listeningUnitAccountLimitRule =
  'Each listening unit account must fit its supplied meaningMaxChars.';
const index = z.number().int().nonnegative();
const turnIndex = z.number().int().positive();
const meaning = z.string().trim().min(1).max(120);
const relation = z.enum([
  'meaning_expression',
  'grammatical_form',
  'claimed_equivalence',
  'explicit_transformation',
  'explicit_repair',
]);
const check = z.enum(['aligned', 'different', 'not_applicable', 'uncertain']);
const pairShape = {
  premiseUnitIndex: index,
  exampleUnitIndex: index,
  premiseMeaning: meaning,
  exampleMeaning: meaning,
  relation,
};
const pairSchema = z.object(pairShape).strict();
const sourceShape = {
  premiseTurnIndex: turnIndex,
  exampleTurnIndex: turnIndex,
  sourcePartIndices: z.array(index).min(1),
};
const normalizedPairSchema = z.object({ pairIndex: index, ...pairShape, ...sourceShape }).strict();
const assessmentShape = {
  premiseMeaning: meaning,
  exampleMeaning: meaning,
  relation,
  checks: z
    .object({ actor: check, event: check, time: check, modality: check, negation: check })
    .strict(),
  status: z.enum(['supported', 'contradicted', 'uncertain', 'explicitly_repaired']),
  reason: z.string().trim().min(1).max(100),
  remedy: z
    .object({
      kind: z.enum(['correction', 'counterexample']),
      text: z.string().trim().min(1).max(120),
    })
    .strict()
    .nullable(),
};
const comparedShape = {
  pairIndex: index,
  decision: z.literal('compared'),
  ...assessmentShape,
};
const dismissedSchema = z
  .object({
    pairIndex: index,
    decision: z.literal('not_a_teaching_relation'),
    reason: z.string().trim().min(1).max(100),
    replacementPairIndices: z.array(index),
  })
  .strict();
const normalizedComparisonShape = {
  comparisonIndex: index,
  premiseUnitIndex: index,
  exampleUnitIndex: index,
  ...sourceShape,
};
const normalizedComparedSchema = z
  .object({ ...comparedShape, ...normalizedComparisonShape })
  .strict();
const normalizedAdditionalSchema = z
  .object({ ...assessmentShape, ...normalizedComparisonShape })
  .strict();
const extractionShape = {
  version: z.literal(2),
  ...listeningSourceBindingShape,
  unitAccounts: z.array(z.string().trim().min(1)),
  pairs: z.array(normalizedPairSchema),
};
const witnessShape = {
  version: z.literal(2),
  ...listeningSourceBindingShape,
  proposedPairs: z.array(normalizedPairSchema),
  pairDecisions: z.array(z.union([normalizedComparedSchema, dismissedSchema])),
  additionalPairs: z.array(normalizedAdditionalSchema),
};
const extractionBaseSchema = z.object(extractionShape).strict();
const witnessBaseSchema = z.object(witnessShape).strict();
export type ListeningPassageExtraction = z.infer<typeof extractionBaseSchema>;
export type ListeningPassageWitness = z.infer<typeof witnessBaseSchema>;
type Pair = z.infer<typeof pairSchema>;
type Assessment = z.infer<z.ZodObject<typeof assessmentShape>>;
type Comparison =
  z.infer<typeof normalizedComparedSchema> | z.infer<typeof normalizedAdditionalSchema>;

function invalid(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message = 'Invalid listening passage witness evidence.'
) {
  context.addIssue({
    code: 'custom',
    path,
    message,
  });
}

function negative(value: Assessment) {
  return value.status === 'contradicted' || value.status === 'uncertain';
}

function checkAssessment(value: Assessment, context: z.RefinementCtx, path: PropertyKey[]) {
  const checks = Object.values(value.checks);
  if (negative(value) && value.remedy === null) invalid(context, [...path, 'remedy']);
  if (!negative(value) && checks.includes('uncertain')) invalid(context, [...path, 'status']);
  if (
    !negative(value) &&
    ['meaning_expression', 'claimed_equivalence'].includes(value.relation) &&
    checks.includes('different')
  )
    invalid(context, [...path, 'status'], supportedMeaningDifferenceRule);
  if (value.status === 'explicitly_repaired' && value.relation !== 'explicit_repair')
    invalid(context, [...path, 'relation']);
}

function checkPairs(
  pairs: readonly (Pair & z.infer<z.ZodObject<typeof sourceShape>>)[],
  binding: ListeningSourceBinding,
  context: z.RefinementCtx,
  path: PropertyKey[]
) {
  const maximum = new Set(binding.units.map((unit) => unit.turnIndex)).size * relationBudgetPerTurn;
  if (pairs.length > maximum) invalid(context, path);
  pairs.forEach((pair, position) => {
    const premise = binding.units[pair.premiseUnitIndex];
    const example = binding.units[pair.exampleUnitIndex];
    if (
      !premise ||
      !example ||
      pair.premiseTurnIndex !== premise.turnIndex ||
      pair.exampleTurnIndex !== example.turnIndex
    )
      invalid(context, [...path, position]);
    if (
      pair.sourcePartIndices.some(
        (part, index) => index > 0 && part <= pair.sourcePartIndices[index - 1]
      )
    )
      invalid(context, [...path, position, 'sourcePartIndices']);
  });
}

function checkExtraction(value: ListeningPassageExtraction, context: z.RefinementCtx) {
  if (value.unitAccounts.length !== value.units.length) invalid(context, ['unitAccounts']);
  value.unitAccounts.forEach((account, position) => {
    const unit = value.units[position];
    if (!unit || account.length > Math.max(120, (unit.end - unit.start) * 3))
      invalid(context, ['unitAccounts', position]);
  });
  value.pairs.forEach((pair, position) => {
    if (pair.pairIndex !== position) invalid(context, ['pairs', position, 'pairIndex']);
  });
  checkPairs(value.pairs, value, context, ['pairs']);
}

function comparisons(witness: ListeningPassageWitness): Comparison[] {
  return [
    ...witness.pairDecisions.filter((decision) => decision.decision === 'compared'),
    ...witness.additionalPairs,
  ];
}

function checkWitness(value: ListeningPassageWitness, context: z.RefinementCtx) {
  value.proposedPairs.forEach((pair, position) => {
    if (pair.pairIndex !== position) invalid(context, ['proposedPairs', position, 'pairIndex']);
  });
  checkPairs(value.proposedPairs, value, context, ['proposedPairs']);
  if (value.pairDecisions.length !== value.proposedPairs.length)
    invalid(context, ['pairDecisions']);
  value.pairDecisions.forEach((decision, position) => {
    const original = value.proposedPairs[position];
    if (decision.pairIndex !== position || !original)
      invalid(context, ['pairDecisions', position, 'pairIndex']);
    if (decision.decision === 'not_a_teaching_relation') {
      const replacements = decision.replacementPairIndices;
      if (
        new Set(replacements).size !== replacements.length ||
        replacements.some((index) => !value.additionalPairs[index])
      )
        invalid(context, ['pairDecisions', position, 'replacementPairIndices']);
      return;
    }
    if (
      original &&
      (decision.premiseUnitIndex !== original.premiseUnitIndex ||
        decision.exampleUnitIndex !== original.exampleUnitIndex)
    )
      invalid(context, ['pairDecisions', position]);
    checkAssessment(decision, context, ['pairDecisions', position]);
  });
  value.additionalPairs.forEach((pair, position) =>
    checkAssessment(pair, context, ['additionalPairs', position])
  );
  const assessed = comparisons(value);
  assessed.forEach((comparison, position) => {
    if (comparison.comparisonIndex !== position) invalid(context, ['comparisonIndex', position]);
  });
  checkPairs(assessed, value, context, ['comparisons']);
}

/** Historical teaching packets may omit the new extraction entirely. */
export const listeningPassageExtractionEvidenceSchema =
  extractionBaseSchema.superRefine(checkExtraction);
export const listeningPassageWitnessEvidenceSchema = witnessBaseSchema.superRefine(checkWitness);

function derivePairSource(
  pair: Pick<Pair, 'premiseUnitIndex' | 'exampleUnitIndex'>,
  table: ListeningSourceTable
) {
  const premise = table.units[pair.premiseUnitIndex];
  const example = table.units[pair.exampleUnitIndex];
  if (!premise || !example) throw new Error('Listening comparison unit is not bound.');
  return {
    premiseTurnIndex: premise.turnIndex,
    exampleTurnIndex: example.turnIndex,
    sourcePartIndices: [
      ...new Set([...premise.sourcePartIndices, ...example.sourcePartIndices]),
    ].sort((left, right) => left - right),
  };
}

function checkBoundSources(
  pairs: readonly (Pick<Pair, 'premiseUnitIndex' | 'exampleUnitIndex'> &
    z.infer<z.ZodObject<typeof sourceShape>>)[],
  table: ListeningSourceTable,
  context: z.RefinementCtx,
  path: PropertyKey[]
) {
  pairs.forEach((pair, position) => {
    try {
      const expected = derivePairSource(pair, table);
      if (
        pair.premiseTurnIndex !== expected.premiseTurnIndex ||
        pair.exampleTurnIndex !== expected.exampleTurnIndex ||
        !isDeepStrictEqual(pair.sourcePartIndices, expected.sourcePartIndices)
      )
        invalid(context, [...path, position]);
    } catch {
      invalid(context, [...path, position]);
    }
  });
}

export function listeningPassageExtractionSchema(
  fields: unknown,
  turns: readonly NormalizedListeningTurn[]
) {
  return listeningPassageExtractionEvidenceSchema.superRefine((value, refinement) => {
    try {
      const table = validateListeningSourceBinding(value, fields, turns);
      checkBoundSources(value.pairs, table, refinement, ['pairs']);
    } catch {
      invalid(refinement, ['units']);
    }
  });
}

export function parseListeningPassageExtraction(
  value: unknown,
  fields: unknown,
  turns: readonly NormalizedListeningTurn[]
): ListeningPassageExtraction {
  return listeningPassageExtractionSchema(fields, turns).parse(value);
}

function listeningPassageWitnessSchema(
  fields: unknown,
  turns: readonly NormalizedListeningTurn[],
  extraction?: ListeningPassageExtraction
) {
  const original = extraction
    ? parseListeningPassageExtraction(extraction, fields, turns)
    : undefined;
  return listeningPassageWitnessEvidenceSchema.superRefine((value, refinement) => {
    try {
      const table = validateListeningSourceBinding(value, fields, turns);
      checkBoundSources(value.proposedPairs, table, refinement, ['proposedPairs']);
      checkBoundSources(comparisons(value), table, refinement, ['comparisons']);
      if (
        original &&
        (!isDeepStrictEqual(value.proposedPairs, original.pairs) ||
          !isDeepStrictEqual(value.units, original.units) ||
          value.locale !== original.locale)
      )
        invalid(refinement, ['proposedPairs']);
    } catch {
      invalid(refinement, ['units']);
    }
  });
}

export function parseListeningPassageWitness(
  value: unknown,
  fields: unknown,
  turns: readonly NormalizedListeningTurn[],
  extraction?: ListeningPassageExtraction
): ListeningPassageWitness {
  return listeningPassageWitnessSchema(fields, turns, extraction).parse(value);
}

type ExtractionResponse = { unitAccounts: Record<string, string>; pairs: Pair[] };
const comparedResponseSchema = z.object(comparedShape).strict();
const additionalResponseSchema = z
  .object({ premiseUnitIndex: index, exampleUnitIndex: index, ...assessmentShape })
  .strict();
type WitnessResponse = {
  pairDecisions: (z.infer<typeof comparedResponseSchema> | z.infer<typeof dismissedSchema>)[];
  additionalPairs: z.infer<typeof additionalResponseSchema>[];
};

function compileExtraction(
  value: ExtractionResponse,
  table: ListeningSourceTable
): ListeningPassageExtraction {
  return {
    version: 2,
    ...retainListeningSourceBinding(table),
    unitAccounts: table.units.map((unit) => value.unitAccounts[String(unit.unitIndex)]),
    pairs: value.pairs.map((pair, pairIndex) => ({
      ...pair,
      pairIndex,
      ...derivePairSource(pair, table),
    })),
  };
}

function compileWitness(
  value: WitnessResponse,
  original: ListeningPassageExtraction,
  table: ListeningSourceTable
): ListeningPassageWitness {
  let comparisonIndex = 0;
  return {
    version: 2,
    ...retainListeningSourceBinding(table),
    proposedPairs: structuredClone(original.pairs),
    pairDecisions: value.pairDecisions.map((decision) => {
      if (decision.decision === 'not_a_teaching_relation') return decision;
      const pair = original.pairs[decision.pairIndex];
      if (!pair) throw new Error('Listening pair decision is not bound.');
      const source = {
        premiseUnitIndex: pair.premiseUnitIndex,
        exampleUnitIndex: pair.exampleUnitIndex,
      };
      return {
        ...decision,
        ...source,
        comparisonIndex: comparisonIndex++,
        ...derivePairSource(source, table),
      };
    }),
    additionalPairs: value.additionalPairs.map((pair) => ({
      ...pair,
      comparisonIndex: comparisonIndex++,
      ...derivePairSource(pair, table),
    })),
  };
}

function addErrors(context: z.RefinementCtx, error: z.ZodError) {
  for (const issue of error.issues)
    context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
}

export function listeningPassageExtractionResponseSchema(
  fields: unknown,
  turns: readonly NormalizedListeningTurn[],
  targetLang: string
) {
  const table = buildListeningSourceUnits(fields, turns, targetLang);
  const unitIndex = z.literal(table.units.map((unit) => unit.unitIndex));
  const normalized = listeningPassageExtractionSchema(fields, turns);
  return z
    .object({
      unitAccounts: z
        .object(
          Object.fromEntries(
            table.units.map((unit) => [
              String(unit.unitIndex),
              z.string().trim().min(1).max(unit.meaningMaxChars),
            ])
          )
        )
        .strict(),
      pairs: z
        .array(pairSchema.extend({ premiseUnitIndex: unitIndex, exampleUnitIndex: unitIndex }))
        .max(turns.length * relationBudgetPerTurn),
    })
    .strict()
    .superRefine((value, refinement) => {
      const parsed = normalized.safeParse(compileExtraction(value, table));
      if (!parsed.success) addErrors(refinement, parsed.error);
    });
}

export function parseListeningPassageExtractionResponse(
  value: unknown,
  fields: unknown,
  turns: readonly NormalizedListeningTurn[],
  targetLang: string
): ListeningPassageExtraction {
  const table = buildListeningSourceUnits(fields, turns, targetLang);
  const response = listeningPassageExtractionResponseSchema(fields, turns, targetLang).parse(value);
  return parseListeningPassageExtraction(compileExtraction(response, table), fields, turns);
}

function judgeSourceTable(
  fields: unknown,
  turns: readonly NormalizedListeningTurn[],
  extraction: ListeningPassageExtraction,
  targetLang: string
) {
  const original = parseListeningPassageExtraction(extraction, fields, turns);
  const table = buildListeningSourceUnits(fields, turns, targetLang);
  if (
    !isDeepStrictEqual(retainListeningSourceBinding(table), {
      locale: original.locale,
      units: original.units,
    })
  )
    throw new Error('Listening judge source differs from the captured extraction.');
  return { original, table };
}

export function listeningPassageWitnessResponseSchema(
  fields: unknown,
  turns: readonly NormalizedListeningTurn[],
  extraction: ListeningPassageExtraction,
  targetLang: string
) {
  const { original, table } = judgeSourceTable(fields, turns, extraction, targetLang);
  const unitIndex = z.literal(table.units.map((unit) => unit.unitIndex));
  const limit = turns.length * relationBudgetPerTurn;
  const pairIndex = z.literal(
    original.pairs.length ? original.pairs.map((pair) => pair.pairIndex) : [0]
  );
  const normalized = listeningPassageWitnessSchema(fields, turns, original);
  return z
    .object({
      pairDecisions: z
        .array(
          z.union([
            comparedResponseSchema.extend({ pairIndex }),
            dismissedSchema.extend({
              pairIndex,
              replacementPairIndices: z.array(index.max(limit - 1)).max(limit),
            }),
          ])
        )
        .length(original.pairs.length),
      additionalPairs: z
        .array(
          additionalResponseSchema.extend({
            premiseUnitIndex: unitIndex,
            exampleUnitIndex: unitIndex,
          })
        )
        .max(limit),
    })
    .strict()
    .superRefine((value, refinement) => {
      const parsed = normalized.safeParse(compileWitness(value, original, table));
      if (!parsed.success) addErrors(refinement, parsed.error);
    });
}

export function parseListeningPassageWitnessResponse(
  value: unknown,
  fields: unknown,
  turns: readonly NormalizedListeningTurn[],
  extraction: ListeningPassageExtraction,
  targetLang: string
): ListeningPassageWitness {
  const { original, table } = judgeSourceTable(fields, turns, extraction, targetLang);
  const response = listeningPassageWitnessResponseSchema(fields, turns, original, targetLang).parse(
    value
  );
  return parseListeningPassageWitness(
    compileWitness(response, original, table),
    fields,
    turns,
    original
  );
}

export function listeningPassageWitnessFailure(
  witness: ListeningPassageWitness
): { issue: 'incorrect' | 'uncertain'; feedback: string } | undefined {
  const retained = comparisons(listeningPassageWitnessEvidenceSchema.parse(witness)).filter(
    negative
  );
  if (!retained.length) return undefined;
  const contradicted = retained.find((comparison) => comparison.status === 'contradicted');
  const first = contradicted ?? retained[0];
  return {
    issue: contradicted ? 'incorrect' : 'uncertain',
    feedback: `Listening passage comparison ${first.comparisonIndex} is ${first.status}; ${retained.length} negative comparisons. Untrusted witness reason: ${first.reason}`,
  };
}

export function listeningPassageWitnessRepairFindings(
  witness: ListeningPassageWitness,
  fields: unknown,
  turns: readonly NormalizedListeningTurn[]
): TeachingFinding[] {
  const parsed = parseListeningPassageWitness(witness, fields, turns);
  const table = validateListeningSourceBinding(parsed, fields, turns);
  const parts = buildTeachingSourceParts(fields);
  return comparisons(parsed)
    .filter(negative)
    .map((comparison) => {
      const example = table.units[comparison.exampleUnitIndex];
      const sourcePartIndex = comparison.sourcePartIndices.find((part) =>
        example.sourcePartIndices.includes(part)
      );
      if (sourcePartIndex === undefined || comparison.remedy === null)
        throw new Error('Listening comparison repair evidence is incomplete.');
      return deriveTeachingFinding(
        {
          sourcePartIndex,
          issue: comparison.status === 'contradicted' ? 'incorrect' : 'uncertain',
          rule: 'The example must support the stated teaching situation or claim.',
          defect: comparison.reason,
          remedy: comparison.remedy,
        },
        parts
      );
    });
}

/** Keep both exact operands available when a rejected comparison needs a local repair. */
export function listeningPassageWitnessRepairTurnIndices(
  witness: ListeningPassageWitness,
  fields: unknown,
  turns: readonly NormalizedListeningTurn[]
): number[] {
  const parsed = parseListeningPassageWitness(witness, fields, turns);
  return [
    ...new Set(
      comparisons(parsed)
        .filter(negative)
        .flatMap((comparison) => [comparison.premiseTurnIndex, comparison.exampleTurnIndex])
    ),
  ].sort((left, right) => left - right);
}
