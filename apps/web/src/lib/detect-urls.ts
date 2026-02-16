/**
 * Detect URLs in a message string.
 * Returns an array of matched URLs (http/https only).
 *
 * Extracted to its own module so client-side code can import it
 * without pulling in server-only dependencies from discovery-agent.ts.
 */
export function detectUrls(message: string | undefined | null): string[] {
  if (!message) return [];
  const urlRegex = /https?:\/\/[^\s<>)"',]+/gi;
  const matches = message.match(urlRegex);
  return matches ? [...new Set(matches)] : [];
}
