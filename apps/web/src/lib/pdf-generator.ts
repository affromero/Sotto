import type { ReferenceData } from '@/types/reference';

interface TranscriptSegment {
  speaker: string;
  text: string;
  startTime: number | null;
}

interface EpisodeTranscriptData {
  title: string;
  topic: string;
  creatorName: string;
  createdAt: Date;
  segments: TranscriptSegment[];
  references: ReferenceData[];
}

/**
 * Format seconds as [MM:SS], or [--:--] if null.
 */
function formatTimestamp(seconds: number | null): string {
  if (seconds === null) return '[--:--]';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `[${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}]`;
}

/**
 * Generate a markdown transcript for a episode with timestamps and references.
 */
export function generateEpisodeTranscript(data: EpisodeTranscriptData): string {
  const dateStr = data.createdAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const lines: string[] = [];

  // Header
  lines.push(`# ${data.title}`);
  lines.push('');
  lines.push(`${data.topic} · By ${data.creatorName} · ${dateStr}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Transcript body
  for (const segment of data.segments) {
    const timestamp = formatTimestamp(segment.startTime);
    const speakerLabel = segment.speaker;

    lines.push(`${timestamp} **${speakerLabel}**`);
    lines.push(segment.text);
    lines.push('');
  }

  // References section
  if (data.references.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## References');
    lines.push('');

    const sorted = [...data.references].sort((a, b) => a.number - b.number);
    for (const ref of sorted) {
      let line = `[${ref.number}] *${ref.title}*`;

      if (ref.authors.length > 0) {
        line += ` — ${ref.authors.join(', ')}`;
      }
      if (ref.year) {
        line += ` (${ref.year})`;
      }
      if (ref.publisher) {
        line += `. ${ref.publisher}`;
      }
      if (ref.doi) {
        line += `. DOI: ${ref.doi}`;
      }

      lines.push(line);

      if (ref.url) {
        lines.push(`    ${ref.url}`);
      }

      lines.push('');
    }
  }

  return lines.join('\n');
}
