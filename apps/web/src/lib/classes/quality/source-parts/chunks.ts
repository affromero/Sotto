/** Exact bounded excerpts, preserving Unicode code points and original whitespace. */
export function buildReviewSourceParts(source: string, limit: number): string[] {
  if (!Number.isInteger(limit) || limit < 2) throw new Error('Invalid source-part limit');
  const parts: string[] = [];
  let part = '';
  for (const character of source) {
    if (part.length + character.length > limit) {
      if (part.trim()) parts.push(part);
      part = '';
    }
    part += character;
  }
  if (part.trim()) parts.push(part);
  return parts;
}
