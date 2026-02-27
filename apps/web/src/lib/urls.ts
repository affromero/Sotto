export function profileUrl(user: { id: string; handle?: string | null }): string {
  return user.handle ? `/@${user.handle}` : `/profile/${user.id}`;
}

export function absoluteProfileUrl(user: { id: string; handle?: string | null }, appUrl: string): string {
  return `${appUrl}${profileUrl(user)}`;
}

/**
 * Generate a podcast URL — vanity if slug + handle available, fallback to /podcast/{id}.
 */
export function podcastUrl(podcast: { id: string; slug?: string | null }, handle?: string | null): string {
  if (podcast.slug && handle) {
    return `/@${handle}/${podcast.slug}`;
  }
  return `/podcast/${podcast.id}`;
}

/**
 * Generate an absolute podcast URL.
 */
export function absolutePodcastUrl(
  podcast: { id: string; slug?: string | null },
  handle?: string | null,
  appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://sotto.fm'
): string {
  return `${appUrl}${podcastUrl(podcast, handle)}`;
}
