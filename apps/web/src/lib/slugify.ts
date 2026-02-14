/**
 * Generate a URL-safe slug from a tag name.
 *
 * - Lowercase, trimmed
 * - `&` and `/` become hyphens
 * - Whitespace collapsed to single hyphens
 * - Non-alphanumeric characters (except hyphens) stripped
 * - Leading/trailing hyphens removed
 * - Capped at 50 characters
 */
export function generateTagSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[&/]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}
