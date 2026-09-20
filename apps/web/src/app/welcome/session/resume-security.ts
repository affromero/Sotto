/** Browser resume data can retain a service location, never embedded credentials. */
export function resumeEndpoint(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return '';
    return value;
  } catch {
    return '';
  }
}

export function resumeEndpoints(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([provider, value]) => [provider, resumeEndpoint(value)])
  );
}
