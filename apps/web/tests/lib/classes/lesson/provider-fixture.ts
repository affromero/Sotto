/** Provider fixtures use word arrays; retained classes and reviewers use ordinary text. */
export function teachingProviderDraft(value: unknown): unknown {
  if (typeof value === 'string') return value.trim().split(/\s+/u);
  if (Array.isArray(value)) return value.map(teachingProviderDraft);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, field]) => [key, teachingProviderDraft(field)])
    );
  return value;
}
