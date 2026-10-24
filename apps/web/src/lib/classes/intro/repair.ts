import { z } from 'zod';
import { type IntroAuditAddress, ReviewerProtocolError } from '../quality/teaching-quality';
import type { IntroRepairBindings } from './bindings';
import { freshIntroProtocol, introExampleReferenceSchema, scopedIntroAtomSchema } from './protocol';

type CoherenceAddress =
  | { field: 'focus' | 'tips'; index: number; exampleIndex: number }
  | { field: 'examples'; index: number };

type IntroCoherencePatch =
  | { field: 'focus' | 'tips'; index: number; exampleIndex: number; text: string }
  | { field: 'examples'; index: number; note: string };

function addressKey(address: IntroAuditAddress): string {
  return 'index' in address ? `${address.field}:${address.index}` : address.field;
}

function coherenceScope(
  rejected: readonly IntroAuditAddress[],
  bindings: IntroRepairBindings | null
): CoherenceAddress[] {
  if (!bindings) return [];
  const implicated = new Set<number>();
  const required = new Set(rejected.map(addressKey));
  for (const address of rejected) {
    if (address.field === 'examples') implicated.add(address.index);
    if (address.field === 'focus' || address.field === 'tips') {
      const observation = bindings[address.field][address.index];
      if (!observation) throw new ReviewerProtocolError();
      implicated.add(observation.index);
    }
  }
  const scope: CoherenceAddress[] = [];
  for (const field of ['focus', 'tips'] as const) {
    for (const [index, observation] of bindings[field].entries()) {
      if (implicated.has(observation.index) && !required.has(`${field}:${index}`))
        scope.push({ field, index, exampleIndex: observation.index });
    }
  }
  for (const index of implicated) {
    if (!bindings.targets[index]) throw new ReviewerProtocolError();
    if (!required.has(`examples:${index}`)) scope.push({ field: 'examples', index });
  }
  return scope;
}

export function semanticIntroRepairProtocol(
  rejectedAddresses: readonly IntroAuditAddress[],
  immersion: boolean,
  bindings: IntroRepairBindings | null
) {
  const shape: Record<string, z.ZodType> = {};
  const indexedShapes = new Map<'focus' | 'tips' | 'examples', Record<string, z.ZodType>>();
  const seen = new Set<string>();
  for (const address of rejectedAddresses) {
    const key = addressKey(address);
    if (seen.has(key)) throw new ReviewerProtocolError();
    seen.add(key);
    if (address.field === 'purpose' || address.field === 'about') {
      shape[address.field] =
        address.field === 'about' ? introExampleReferenceSchema : z.string().min(1);
      continue;
    }
    if (address.field === 'visuals') continue;
    if (!('index' in address)) throw new ReviewerProtocolError();
    const maximum = address.field === 'focus' ? 6 : 5;
    if (!Number.isInteger(address.index) || address.index < 0 || address.index >= maximum)
      throw new ReviewerProtocolError();
    const indexedShape = indexedShapes.get(address.field) ?? {};
    indexedShape[String(address.index)] =
      address.field === 'examples'
        ? freshIntroProtocol(immersion).exampleSchema
        : scopedIntroAtomSchema;
    indexedShapes.set(address.field, indexedShape);
  }
  for (const [field, indexedShape] of indexedShapes) shape[field] = z.object(indexedShape).strict();
  if (Object.keys(shape).length === 0) throw new ReviewerProtocolError();

  const scope = coherenceScope(rejectedAddresses, bindings);
  const variants: z.ZodType<IntroCoherencePatch>[] = scope.map((address) =>
    address.field === 'examples'
      ? z
          .object({
            field: z.literal('examples'),
            index: z.literal(address.index),
            note: z.string().min(1),
          })
          .strict()
      : z
          .object({
            field: z.literal(address.field),
            index: z.literal(address.index),
            exampleIndex: z.literal(address.exampleIndex),
            text: z.string().min(1),
          })
          .strict()
  );
  const coherenceSchema = variants.length
    ? z
        .array(variants.length === 1 ? variants[0] : z.union(variants))
        .max(variants.length)
        .nullable()
    : null;
  if (coherenceSchema) shape.coherence = coherenceSchema;
  const schema = z.object(shape).strict();
  return {
    schema,
    coherenceSchema,
    coherenceScope: scope,
    responseFormat: {
      name: 'class_intro_repair',
      schema: z.toJSONSchema(schema, { target: 'draft-7' }),
    },
  };
}
