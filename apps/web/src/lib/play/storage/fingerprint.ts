import { createHash } from 'node:crypto';
import { z } from 'zod';

const jsonSchema = z.json();

function encode(value: z.infer<typeof jsonSchema>): string {
  if (Array.isArray(value)) return `[${value.map(encode).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${encode(value[key]!)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

/** JSON key order must not change a mutation identity or access-state fence. */
export function playFingerprint(value: unknown): string {
  return createHash('sha256')
    .update(encode(jsonSchema.parse(value)))
    .digest('hex');
}
