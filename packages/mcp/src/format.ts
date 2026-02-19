import type { Podcast, PodcastDetail, FeedResponse, UserProfile } from './types.js';

function formatDuration(seconds: number | null): string {
  if (!seconds) return 'N/A';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function formatTags(podcast: Podcast): string {
  if (!podcast.tags || podcast.tags.length === 0) return '';
  return podcast.tags.map((t) => t.tag.name).join(', ');
}

export function formatPodcastSummary(p: Podcast): string {
  const lines = [
    `**${p.title}**`,
    `ID: ${p.id}`,
    `Status: ${p.status}`,
    `Visibility: ${p.visibility}`,
    `Duration: ${formatDuration(p.duration)}`,
    `Plays: ${p.playCount} | Likes: ${p.likeCount} | Forks: ${p.forkCount}`,
  ];
  if (p.user) lines.push(`Creator: ${p.user.name || 'Anonymous'}`);
  const tags = formatTags(p);
  if (tags) lines.push(`Tags: ${tags}`);
  if (p.forkedFromId) lines.push(`Forked from: ${p.forkedFromId}`);
  lines.push(`Created: ${p.createdAt}`);
  return lines.join('\n');
}

export function formatPodcastDetail(p: PodcastDetail): string {
  const lines = [formatPodcastSummary(p)];

  if (p.topic) {
    lines.push('', `Topic: ${p.topic}`);
  }

  if (p.segments && p.segments.length > 0) {
    lines.push('', `Segments: ${p.segments.length}`);
    for (const seg of p.segments.slice(0, 5)) {
      const preview = seg.text.length > 80 ? seg.text.slice(0, 80) + '...' : seg.text;
      lines.push(`  [${seg.speaker}] ${preview}`);
    }
    if (p.segments.length > 5) {
      lines.push(`  ... and ${p.segments.length - 5} more`);
    }
  }

  if (p.interactions && p.interactions.length > 0) {
    lines.push('', `Q&A: ${p.interactions.length} interaction(s)`);
  }

  return lines.join('\n');
}

export function formatPodcastList(podcasts: Podcast[]): string {
  if (podcasts.length === 0) return 'No podcasts found.';
  return podcasts.map((p, i) => `${i + 1}. ${formatPodcastSummary(p)}`).join('\n\n');
}

export function formatFeed(feed: FeedResponse): string {
  const header = `Found ${feed.total} podcast(s)`;
  const pagination = feed.page ? ` (page ${feed.page})` : '';
  const more = feed.hasMore ? ' — more available' : '';

  if (feed.podcasts.length === 0) return `${header}${pagination}. No results.`;

  const items = feed.podcasts.map((p, i) => `${i + 1}. ${formatPodcastSummary(p)}`).join('\n\n');
  return `${header}${pagination}${more}\n\n${items}`;
}

export function formatProfile(u: UserProfile): string {
  const lines = [
    `**${u.name || 'Anonymous'}**`,
    u.handle ? `@${u.handle}` : null,
    u.bio ? `Bio: ${u.bio}` : null,
    `Podcasts: ${u.podcastCount} | Followers: ${u.followerCount} | Following: ${u.followingCount}`,
    `Member since: ${u.createdAt}`,
  ];
  return lines.filter(Boolean).join('\n');
}

export function formatCreated(result: { id: string; status?: string }): string {
  return `Podcast created!\nID: ${result.id}\nStatus: ${result.status || 'EXTRACTING'}\n\nThe podcast is now being generated. Use get_podcast to check progress.`;
}

export function formatForked(result: { id: string }): string {
  return `Podcast forked!\nID: ${result.id}\n\nThe forked podcast is now being generated. Use get_podcast to check progress.`;
}

export function formatDeleted(): string {
  return 'Podcast deleted successfully.';
}
