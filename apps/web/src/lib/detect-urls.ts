/**
 * Detect URLs in a message string.
 * Returns an array of matched URLs (http/https only).
 *
 * Kept in its own client-safe module with no server-only dependencies.
 */
export function detectUrls(message: string | undefined | null): string[] {
  if (!message) return [];
  const urlRegex = /https?:\/\/[^\s<>)"',]+/gi;
  const matches = message.match(urlRegex);
  return matches ? [...new Set(matches)] : [];
}
