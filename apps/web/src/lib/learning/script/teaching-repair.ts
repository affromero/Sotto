import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import {
  normalizeListeningTurns,
  type NormalizedListeningTurn,
} from '../../classes/quality/listening-audit/projection';

type ScriptCandidate = {
  turns: Array<{ speaker: string; text: string; direction?: string }>;
};
export type TeachingScriptRepairScope = {
  turnIndices: readonly number[];
  turns: readonly NormalizedListeningTurn[];
};

/** Required indexed keys match the existing class-intro repair contract across providers. */
export function teachingScriptRepairContract(
  candidate: ScriptCandidate,
  scope: TeachingScriptRepairScope
) {
  const { turnIndices } = scope;
  if (
    !isDeepStrictEqual(normalizeListeningTurns(candidate.turns), scope.turns) ||
    !turnIndices.length ||
    new Set(turnIndices).size !== turnIndices.length ||
    turnIndices.some(
      (index) => !Number.isInteger(index) || index < 1 || index > candidate.turns.length
    )
  )
    throw new Error('Teaching script repair requires bound turn indices.');
  const shape: Record<string, z.ZodString> = {};
  for (const index of turnIndices) shape[String(index)] = z.string().trim().min(1);
  const schema = z.object({ turnTexts: z.object(shape).strict() }).strict();
  return {
    schema,
    responseFormat: {
      name: 'learning_script_turn_repair',
      schema: z.toJSONSchema(schema, { target: 'draft-7' }),
    },
  };
}

/** Compile only authorized text leaves; all script structure and metadata stay server-owned. */
export function applyTeachingScriptRepair<T extends ScriptCandidate>(
  content: string,
  schema: ReturnType<typeof teachingScriptRepairContract>['schema'],
  candidate: T
): T {
  const patch = schema.parse(JSON.parse(content));
  const merged = structuredClone(candidate);
  for (const [index, text] of Object.entries(patch.turnTexts))
    merged.turns[Number(index) - 1].text = text;
  return merged;
}

/** Canonical parsing must not mutate the preserved portion of an already parsed candidate. */
export function assertTeachingScriptRepairPreserved<T extends ScriptCandidate>(
  original: T,
  parsed: ScriptCandidate & Record<string, unknown>,
  scope: TeachingScriptRepairScope
) {
  if (parsed.turns.length !== original.turns.length)
    throw new Error('Teaching script repair changed the original turn count.');
  const expected = structuredClone(original);
  for (const index of scope.turnIndices)
    expected.turns[index - 1].text = parsed.turns[index - 1].text;
  if (
    Object.keys(expected).some((key) => !isDeepStrictEqual(expected[key as keyof T], parsed[key]))
  )
    throw new Error('Teaching script repair changed preserved script content.');
}
