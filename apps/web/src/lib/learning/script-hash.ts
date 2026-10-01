import { createHash } from 'node:crypto';
import { z } from 'zod';

const turnsSchema = z
  .array(
    z.object({
      speaker: z.string().min(1),
      text: z.string().refine((text) => text.trim().length > 0),
      direction: z.string().optional(),
    })
  )
  .min(1);

/** Tuple encoding remains stable when PostgreSQL reorders JSON object keys. */
export function learningScriptHash(turns: unknown): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        turnsSchema.parse(turns).map((turn) => [turn.speaker, turn.text, turn.direction ?? null])
      )
    )
    .digest('hex');
}
