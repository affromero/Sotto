/**
 * Preset profile avatars for the local sign-in: cute animals from the Colombian
 * tropics. Each has a generated illustration at /avatars/{slug}.png (aula-styled
 * background). Until the images are generated, the picker falls back to the emoji
 * on an aula gradient tile, so the feature works fully offline with no assets.
 *
 * To generate the real images, run scripts/generate-avatars.mjs with a Gemini key
 * (model gemini-2.5-flash-image). The prompt and slugs live there.
 */

export interface AnimalAvatar {
  slug: string;
  name: string;
  /** Fallback glyph shown until the generated image exists. */
  emoji: string;
  /** Aula-harmonized accent for the fallback tile gradient. */
  hue: string;
}

export const ANIMAL_AVATARS: AnimalAvatar[] = [
  { slug: 'capybara', name: 'Capybara', emoji: '🦫', hue: '#3F4FB0' },
  { slug: 'iguana', name: 'Iguana', emoji: '🦎', hue: '#0D9488' },
  { slug: 'sloth', name: 'Sloth', emoji: '🦥', hue: '#8A6D3B' },
  { slug: 'toucan', name: 'Toucan', emoji: '🐦', hue: '#B83280' },
  { slug: 'macaw', name: 'Macaw', emoji: '🦜', hue: '#C2730A' },
  { slug: 'frog', name: 'Poison frog', emoji: '🐸', hue: '#1C7A6B' },
  { slug: 'hummingbird', name: 'Hummingbird', emoji: '🐤', hue: '#6AA0FF' },
  { slug: 'jaguar', name: 'Jaguar', emoji: '🐆', hue: '#2A3550' },
];

const BY_SLUG = new Map(ANIMAL_AVATARS.map((a) => [a.slug, a]));

/** The image path for an avatar slug, or null for an uploaded or unknown image. */
export function avatarImagePath(slug: string): string | null {
  return BY_SLUG.has(slug) ? `/avatars/${slug}.png` : null;
}

export function isAnimalSlug(value: string): boolean {
  return BY_SLUG.has(value);
}

export function getAnimalAvatar(slug: string): AnimalAvatar | undefined {
  return BY_SLUG.get(slug);
}
