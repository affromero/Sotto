export class PrerequisiteCapacityError extends Error {
  constructor() {
    super('The class material is too large to review safely.');
    this.name = 'PrerequisiteCapacityError';
  }
}

/** Parse structured model output, tolerating an enclosing Markdown JSON fence. */
export function parsePrerequisiteJson(content: string): unknown {
  try {
    return JSON.parse(
      content
        .trim()
        .replace(/^```(?:json)?\s*/u, '')
        .replace(/\s*```$/u, '')
    );
  } catch {
    throw new Error('Prerequisite teaching returned invalid structured content.');
  }
}

/** Moderation inspects at most 32,000 characters of the provider's user message. */
export function requireModeratedPrerequisitePayload(value: string): string {
  if (value.length > 32_000 || Buffer.byteLength(value, 'utf8') > 65_536)
    throw new PrerequisiteCapacityError();
  return value;
}

/** Reserve room for the complete base candidate in the mandatory review request. */
export function requirePrerequisiteBaseCapacity(sourcePayload: string): void {
  if (sourcePayload.length > 17_984 || Buffer.byteLength(sourcePayload, 'utf8') > 45_520)
    throw new PrerequisiteCapacityError();
}

export function requirePrerequisiteBaseCandidate(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (serialized.length > 14_000 || Buffer.byteLength(serialized, 'utf8') > 20_000)
    throw new Error('Prerequisite teaching is too large to review safely.');
}
