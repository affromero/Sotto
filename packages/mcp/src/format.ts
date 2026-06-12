import type {
  AgentIngestResult,
  Episode,
  EpisodeDetail,
  UserProfile,
} from './types.js';

function formatDuration(seconds: number | null): string {
  if (!seconds) return 'N/A';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function formatTags(episode: Episode): string {
  if (!episode.tags || episode.tags.length === 0) return '';
  return episode.tags.map((t) => t.tag.name).join(', ');
}

export function formatEpisodeSummary(p: Episode): string {
  const lines = [
    `**${p.title}**`,
    `ID: ${p.id}`,
    `Status: ${p.status}`,
    `Visibility: ${p.visibility}`,
    `Duration: ${formatDuration(p.duration)}`,
  ];
  if (p.user) lines.push(`Creator: ${p.user.name || 'Anonymous'}`);
  const tags = formatTags(p);
  if (tags) lines.push(`Tags: ${tags}`);
  lines.push(`Created: ${p.createdAt}`);
  return lines.join('\n');
}

export function formatEpisodeDetail(p: EpisodeDetail): string {
  const lines = [formatEpisodeSummary(p)];

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

export function formatEpisodeList(episodes: Episode[]): string {
  if (episodes.length === 0) return 'No episodes found.';
  return episodes.map((p, i) => `${i + 1}. ${formatEpisodeSummary(p)}`).join('\n\n');
}

export function formatProfile(u: UserProfile): string {
  const lines = [
    `**${u.name || 'Anonymous'}**`,
    u.handle ? `@${u.handle}` : null,
    `Episodes: ${u.episodeCount}`,
    `Member since: ${u.createdAt}`,
  ];
  return lines.filter(Boolean).join('\n');
}

export function formatCreated(result: { id: string; status?: string }): string {
  return `Episode created!\nID: ${result.id}\nStatus: ${result.status || 'EXTRACTING'}\n\nThe episode is now being generated. Use get_episode to check progress.`;
}

export function formatAgentIngested(result: AgentIngestResult): string {
  const action = result.idempotent ? 'Agent output already ingested.' : 'Agent output ingested.';
  return `${action}\nID: ${result.id}\nStatus: ${result.status}\n\nThe private episode is now in your library pipeline. Use get_episode to check progress.`;
}

export function formatDeleted(): string {
  return 'Episode deleted successfully.';
}
