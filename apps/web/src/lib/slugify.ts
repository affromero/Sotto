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

/**
 * Convert a title into a URL-safe slug (max 80 chars).
 */
export function slugify(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[&/]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'untitled';
}

/**
 * Generate a unique episode slug for a given user.
 * Appends a numeric suffix (-2, -3, ...) if the base slug is already taken.
 */
export async function generateEpisodeSlug(
  title: string,
  userId: string,
  prisma: { episode: { findUnique: (args: { where: { userId_slug: { userId: string; slug: string } }; select: { id: true } }) => Promise<{ id: string } | null> } }
): Promise<string> {
  const base = slugify(title);
  // Try the base slug first
  const existing = await prisma.episode.findUnique({
    where: { userId_slug: { userId, slug: base } },
    select: { id: true },
  });
  if (!existing) return base;

  // Append numeric suffix until unique
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`;
    const taken = await prisma.episode.findUnique({
      where: { userId_slug: { userId, slug: candidate } },
      select: { id: true },
    });
    if (!taken) return candidate;
  }

  // Fallback: append timestamp
  return `${base}-${Date.now()}`;
}
