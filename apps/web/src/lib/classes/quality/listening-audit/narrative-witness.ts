import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { buildTeachingSourceParts, deriveTeachingFinding } from '../teaching-source/protocol';
import type { NormalizedListeningTurn } from './projection';
import {
  listeningSourceBindingShape,
  retainListeningSourceBinding,
  validateListeningSourceBinding,
  type ListeningSourceBinding,
  type ListeningSourceTable,
} from './source-units';

const index = z.number().int().nonnegative();
const turnIndex = z.number().int().positive();
const reason = z.string().trim().min(1).max(120);
const linkShape = { earlierUnitIndex: index, currentUnitIndex: index };
const linkSchema = z.object(linkShape).strict();
const extractionTurnSchema = z.object({ turnIndex, links: z.array(linkSchema).max(6) }).strict();
const assessmentShape = {
  status: z.enum([
    'consistent',
    'explicit_change',
    'different_group',
    'not_a_reference',
    'contradicted',
    'uncertain',
  ]),
  reason,
  remedy: z
    .object({ kind: z.enum(['correction', 'counterexample']), text: reason })
    .strict()
    .nullable(),
};
const assessmentSchema = z.object(assessmentShape).strict();
const decisionSchema = assessmentSchema.extend({ linkIndex: index }).strict();
const additionalSchema = assessmentSchema.extend(linkShape).strict();
const sourceShape = {
  earlierTurnIndex: turnIndex,
  currentTurnIndex: turnIndex,
  sourcePartIndices: z.array(index).min(1),
};
const decisionEvidenceSchema = decisionSchema.extend({ ...linkShape, ...sourceShape }).strict();
const additionalEvidenceSchema = additionalSchema.extend(sourceShape).strict();
const continuityShape = {
  turnIndex,
  continuity: z.enum(['independent', 'consistent', 'contradicted', 'uncertain']),
  reason,
};
const witnessTurnSchema = z
  .object({
    ...continuityShape,
    linkDecisions: z.array(decisionEvidenceSchema).max(6),
    additionalLinks: z.array(additionalEvidenceSchema).max(6),
  })
  .strict();
const extractionBase = z
  .object({
    version: z.literal(1),
    ...listeningSourceBindingShape,
    turnOrder: z.array(turnIndex).min(1),
    turns: z.array(extractionTurnSchema).min(1),
  })
  .strict();
const witnessBase = z
  .object({
    version: z.literal(1),
    ...listeningSourceBindingShape,
    turnOrder: z.array(turnIndex).min(1),
    proposedTurns: z.array(extractionTurnSchema).min(1),
    turns: z.array(witnessTurnSchema).min(1),
  })
  .strict();
export type ListeningNarrativeExtraction = z.infer<typeof extractionBase>;
export type ListeningNarrativeWitness = z.infer<typeof witnessBase>;
type Link = z.infer<typeof linkSchema>;
type Assessment = z.infer<typeof assessmentSchema>;
type ExtractionResponse = { turns: Record<string, { links: Link[] }> };
type WitnessResponse = {
  turns: Record<
    string,
    {
      reason: string;
      linkDecisions: Record<string, Assessment>;
      additionalLinks: z.infer<typeof additionalSchema>[];
    }
  >;
};

function invalid(context: z.RefinementCtx, path: PropertyKey[]) {
  context.addIssue({
    code: 'custom',
    path,
    message: 'Invalid bound narrative continuity evidence.',
  });
}

function negative(value: Assessment) {
  return value.status === 'contradicted' || value.status === 'uncertain';
}

function deriveContinuity(links: readonly Assessment[]) {
  if (links.some((link) => link.status === 'contradicted')) return 'contradicted';
  if (links.some((link) => link.status === 'uncertain')) return 'uncertain';
  return links.some((link) => link.status !== 'not_a_reference') ? 'consistent' : 'independent';
}

function checkCoverage(
  rows: readonly { turnIndex: number }[],
  binding: ListeningSourceBinding & { turnOrder: number[] },
  context: z.RefinementCtx,
  path: PropertyKey[]
) {
  const expected = binding.turnOrder;
  if (
    expected.some((turn, position) => turn !== position + 1) ||
    binding.units.some((unit) => !expected.includes(unit.turnIndex))
  )
    invalid(context, ['turnOrder']);
  if (rows.length !== expected.length) invalid(context, path);
  rows.forEach((row, position) => {
    if (row.turnIndex !== expected[position]) invalid(context, [...path, position, 'turnIndex']);
  });
}

function checkLinks(
  links: readonly Link[],
  currentTurn: number,
  binding: ListeningSourceBinding,
  context: z.RefinementCtx,
  path: PropertyKey[]
) {
  if (links.length > 6) invalid(context, path);
  const seen = new Set<string>();
  links.forEach((link, position) => {
    const earlier = binding.units[link.earlierUnitIndex];
    const current = binding.units[link.currentUnitIndex];
    const key = `${link.earlierUnitIndex}:${link.currentUnitIndex}`;
    if (
      !earlier ||
      !current ||
      link.earlierUnitIndex >= link.currentUnitIndex ||
      current.turnIndex !== currentTurn ||
      seen.has(key)
    )
      invalid(context, [...path, position]);
    seen.add(key);
  });
}

function checkExtraction(value: ListeningNarrativeExtraction, context: z.RefinementCtx) {
  checkCoverage(value.turns, value, context, ['turns']);
  value.turns.forEach((row, position) =>
    checkLinks(row.links, row.turnIndex, value, context, ['turns', position, 'links'])
  );
}

function checkWitness(value: ListeningNarrativeWitness, context: z.RefinementCtx) {
  checkExtraction({ ...value, turns: value.proposedTurns }, context);
  checkCoverage(value.turns, value, context, ['turns']);
  value.turns.forEach((row, position) => {
    const original = value.proposedTurns[position];
    if (!original || row.linkDecisions.length !== original.links.length)
      invalid(context, ['turns', position, 'linkDecisions']);
    row.linkDecisions.forEach((decision, linkPosition) => {
      const link = original?.links[linkPosition];
      if (
        decision.linkIndex !== linkPosition ||
        !link ||
        decision.earlierUnitIndex !== link.earlierUnitIndex ||
        decision.currentUnitIndex !== link.currentUnitIndex
      )
        invalid(context, ['turns', position, 'linkDecisions', linkPosition]);
    });
    const links = [...row.linkDecisions, ...row.additionalLinks];
    checkLinks(links, row.turnIndex, value, context, ['turns', position]);
    for (const link of links) {
      if (negative(link) !== (link.remedy !== null))
        invalid(context, ['turns', position, 'remedy']);
      if (
        link.earlierTurnIndex !== value.units[link.earlierUnitIndex]?.turnIndex ||
        link.currentTurnIndex !== value.units[link.currentUnitIndex]?.turnIndex
      )
        invalid(context, ['turns', position, 'source']);
    }
    if (row.continuity !== deriveContinuity(links))
      invalid(context, ['turns', position, 'continuity']);
  });
}

export const listeningNarrativeExtractionEvidenceSchema =
  extractionBase.superRefine(checkExtraction);
export const listeningNarrativeWitnessEvidenceSchema = witnessBase.superRefine(checkWitness);

function source(link: Link, table: ListeningSourceTable) {
  const earlier = table.units[link.earlierUnitIndex];
  const current = table.units[link.currentUnitIndex];
  if (!earlier || !current) throw new Error('Narrative operands require exact source units.');
  return {
    earlierTurnIndex: earlier.turnIndex,
    currentTurnIndex: current.turnIndex,
    sourcePartIndices: [
      ...new Set([...earlier.sourcePartIndices, ...current.sourcePartIndices]),
    ].sort((a, b) => a - b),
  };
}

export function parseListeningNarrativeExtraction(
  value: unknown,
  fields: unknown,
  turns: readonly NormalizedListeningTurn[]
) {
  const parsed = listeningNarrativeExtractionEvidenceSchema.parse(value);
  validateListeningSourceBinding(parsed, fields, turns);
  if (
    !isDeepStrictEqual(
      parsed.turnOrder,
      turns.map((turn) => turn.turnIndex)
    )
  )
    throw new Error('Narrative coverage differs from the exact spoken turn table.');
  return parsed;
}

export function parseListeningNarrativeWitness(
  value: unknown,
  fields: unknown,
  turns: readonly NormalizedListeningTurn[],
  extraction?: ListeningNarrativeExtraction
) {
  const parsed = listeningNarrativeWitnessEvidenceSchema.parse(value);
  const table = validateListeningSourceBinding(parsed, fields, turns);
  if (
    !isDeepStrictEqual(
      parsed.turnOrder,
      turns.map((turn) => turn.turnIndex)
    )
  )
    throw new Error('Narrative coverage differs from the exact spoken turn table.');
  if (
    extraction &&
    (!isDeepStrictEqual(parsed.proposedTurns, extraction.turns) ||
      !isDeepStrictEqual(parsed.turnOrder, extraction.turnOrder) ||
      !isDeepStrictEqual(retainListeningSourceBinding(table), {
        locale: extraction.locale,
        units: extraction.units,
      }))
  )
    throw new Error('Narrative decisions differ from their captured extraction.');
  for (const row of parsed.turns)
    for (const link of [...row.linkDecisions, ...row.additionalLinks]) {
      const expected = source(link, table);
      if (
        link.earlierTurnIndex !== expected.earlierTurnIndex ||
        link.currentTurnIndex !== expected.currentTurnIndex ||
        !isDeepStrictEqual(link.sourcePartIndices, expected.sourcePartIndices)
      )
        throw new Error('Narrative evidence source addresses are not bound.');
    }
  return parsed;
}

function refineCompiled<T>(
  value: T,
  refinement: z.RefinementCtx,
  compile: (value: T) => unknown,
  schema: z.ZodType
) {
  const parsed = schema.safeParse(compile(value));
  if (!parsed.success)
    for (const issue of parsed.error.issues)
      refinement.addIssue({ code: 'custom', path: issue.path, message: issue.message });
}

function keyedSchema<T>(entries: Array<[string, z.ZodType<T>]>) {
  return z
    .object(Object.fromEntries(entries))
    .strict()
    .meta({ required: entries.map(([key]) => key) });
}

function boundLinksSchema<T>(
  table: ListeningSourceTable,
  currentTurn: number,
  build: (shape: {
    earlierUnitIndex: z.ZodType<number>;
    currentUnitIndex: z.ZodType<number>;
  }) => z.ZodType<T>,
  capacity = 6
) {
  const branches = table.units
    .filter((unit) => unit.turnIndex === currentTurn && unit.unitIndex > 0)
    .map((unit) =>
      build({
        earlierUnitIndex: index.max(unit.unitIndex - 1),
        currentUnitIndex: z.literal(unit.unitIndex),
      })
    );
  const schema = branches.length > 1 ? z.union(branches) : (branches[0] ?? build(linkShape));
  return z.array(schema).max(branches.length ? capacity : 0);
}

function compileExtraction(response: ExtractionResponse, ids: readonly number[]) {
  return ids.map((turnIndex) => ({ turnIndex, links: response.turns[String(turnIndex)].links }));
}

export function listeningNarrativeExtractionResponseSchema(
  fields: unknown,
  turns: readonly NormalizedListeningTurn[],
  binding: ListeningSourceBinding
) {
  const table = validateListeningSourceBinding(binding, fields, turns);
  const ids = turns.map((turn) => turn.turnIndex);
  return z
    .object({
      turns: keyedSchema(
        ids.map((id) => [
          String(id),
          z
            .object({ links: boundLinksSchema(table, id, (shape) => z.object(shape).strict()) })
            .strict(),
        ])
      ),
    })
    .strict()
    .superRefine((value, refinement) =>
      refineCompiled(
        value,
        refinement,
        (response) => ({
          version: 1,
          ...retainListeningSourceBinding(table),
          turnOrder: ids,
          turns: compileExtraction(response, ids),
        }),
        listeningNarrativeExtractionEvidenceSchema
      )
    );
}

export function parseListeningNarrativeExtractionResponse(
  value: unknown,
  fields: unknown,
  turns: readonly NormalizedListeningTurn[],
  binding: ListeningSourceBinding
) {
  const response = listeningNarrativeExtractionResponseSchema(fields, turns, binding).parse(value);
  const sourceBinding = retainListeningSourceBinding(
    validateListeningSourceBinding(binding, fields, turns)
  );
  return parseListeningNarrativeExtraction(
    {
      version: 1,
      ...sourceBinding,
      turnOrder: turns.map((turn) => turn.turnIndex),
      turns: compileExtraction(
        response,
        turns.map((turn) => turn.turnIndex)
      ),
    },
    fields,
    turns
  );
}

function compileWitness(
  response: WitnessResponse,
  extraction: ListeningNarrativeExtraction,
  table: ListeningSourceTable
): ListeningNarrativeWitness {
  return {
    version: 1,
    ...retainListeningSourceBinding(table),
    turnOrder: [...extraction.turnOrder],
    proposedTurns: structuredClone(extraction.turns),
    turns: extraction.turns.map((original) => {
      const row = response.turns[String(original.turnIndex)];
      return {
        ...row,
        turnIndex: original.turnIndex,
        continuity: deriveContinuity([...Object.values(row.linkDecisions), ...row.additionalLinks]),
        linkDecisions: original.links.map((link, linkIndex) => ({
          ...row.linkDecisions[String(linkIndex)],
          linkIndex,
          ...link,
          ...source(link, table),
        })),
        additionalLinks: row.additionalLinks.map((link) => ({ ...link, ...source(link, table) })),
      };
    }),
  };
}

export function listeningNarrativeWitnessResponseSchema(
  fields: unknown,
  turns: readonly NormalizedListeningTurn[],
  extraction: ListeningNarrativeExtraction
) {
  const original = parseListeningNarrativeExtraction(extraction, fields, turns);
  const table = validateListeningSourceBinding(original, fields, turns);
  return z
    .object({
      turns: keyedSchema(
        original.turns.map((turn) => [
          String(turn.turnIndex),
          z
            .object({
              reason,
              linkDecisions: keyedSchema(
                Array.from(turn.links.keys(), (linkIndex) => [String(linkIndex), assessmentSchema])
              ),
              additionalLinks: boundLinksSchema(
                table,
                turn.turnIndex,
                (shape) => z.object({ ...assessmentShape, ...shape }).strict(),
                6 - turn.links.length
              ),
            })
            .strict(),
        ])
      ),
    })
    .strict()
    .superRefine((value, refinement) => {
      try {
        refineCompiled(
          value,
          refinement,
          (response) => compileWitness(response, original, table),
          listeningNarrativeWitnessEvidenceSchema
        );
      } catch {
        invalid(refinement, ['turns']);
      }
    });
}

export function parseListeningNarrativeWitnessResponse(
  value: unknown,
  fields: unknown,
  turns: readonly NormalizedListeningTurn[],
  extraction: ListeningNarrativeExtraction
) {
  const table = validateListeningSourceBinding(extraction, fields, turns);
  const response = listeningNarrativeWitnessResponseSchema(fields, turns, extraction).parse(value);
  return parseListeningNarrativeWitness(
    compileWitness(response, extraction, table),
    fields,
    turns,
    extraction
  );
}

function rejectedLinks(witness: ListeningNarrativeWitness) {
  return listeningNarrativeWitnessEvidenceSchema
    .parse(witness)
    .turns.flatMap((row) => [...row.linkDecisions, ...row.additionalLinks].filter(negative));
}

export function listeningNarrativeFailure(witness: ListeningNarrativeWitness) {
  const links = rejectedLinks(witness);
  if (!links.length) return undefined;
  const first = links.find((link) => link.status === 'contradicted') ?? links[0];
  return {
    issue: first.status === 'contradicted' ? ('incorrect' as const) : ('uncertain' as const),
    feedback: `Listening narrative continuity is ${first.status}: ${first.reason}`,
  };
}

export function listeningNarrativeRepairFindings(
  witness: ListeningNarrativeWitness,
  fields: unknown,
  turns: readonly NormalizedListeningTurn[]
) {
  const parsed = parseListeningNarrativeWitness(witness, fields, turns);
  const table = validateListeningSourceBinding(parsed, fields, turns);
  const parts = buildTeachingSourceParts(fields);
  return rejectedLinks(parsed).map((link) => {
    if (!link.remedy) throw new Error('Negative narrative continuity requires a repair.');
    const current = table.units[link.currentUnitIndex];
    return deriveTeachingFinding(
      {
        sourcePartIndex: current.sourcePartIndices[0],
        issue: link.status === 'contradicted' ? 'incorrect' : 'uncertain',
        rule: 'Narrative references must preserve the established participants and event facts.',
        defect: link.reason,
        remedy: link.remedy,
      },
      parts
    );
  });
}

export function listeningNarrativeRepairTurnIndices(
  witness: ListeningNarrativeWitness,
  fields: unknown,
  turns: readonly NormalizedListeningTurn[]
) {
  return [
    ...new Set(
      rejectedLinks(parseListeningNarrativeWitness(witness, fields, turns)).flatMap((link) => [
        link.earlierTurnIndex,
        link.currentTurnIndex,
      ])
    ),
  ].sort((a, b) => a - b);
}
