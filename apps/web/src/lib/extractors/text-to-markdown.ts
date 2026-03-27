/**
 * Lightweight plain-text-to-markdown converter.
 * Used when Pinchtab returns raw text that needs basic markdown structure.
 *
 * Detects: paragraph boundaries, heading-like patterns, list patterns.
 * No external dependencies.
 */

/**
 * Heuristically detect if a line looks like a heading:
 * - Short (under 80 chars)
 * - Followed by a longer paragraph
 * - Not ending with punctuation that implies a sentence
 */
function isHeadingCandidate(line: string, nextLine: string | undefined): boolean {
  if (line.length > 80 || line.length < 2) return false;
  if (/[.!?,;:]$/.test(line)) return false;
  if (!nextLine || nextLine.trim().length === 0) return false;
  return nextLine.length > line.length * 1.5;
}

/**
 * Detect if a line looks like a list item.
 */
function isListItem(line: string): boolean {
  return /^[\s]*[-*+•]\s/.test(line) || /^[\s]*\d+[.)]\s/.test(line);
}

/**
 * Convert plain text to basic markdown.
 *
 * - Preserves paragraph structure (double newlines)
 * - Detects heading-like short lines before longer text
 * - Preserves list-like patterns
 * - Normalizes whitespace within paragraphs
 */
export function textToMarkdown(text: string): string {
  if (!text || !text.trim()) return '';

  const lines = text.split('\n');
  const output: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    const nextLine = i + 1 < lines.length ? lines[i + 1]?.trimEnd() : undefined;

    // Empty line → paragraph break
    if (!line.trim()) {
      output.push('');
      continue;
    }

    // List items — preserve as-is
    if (isListItem(line)) {
      const trimmed = line.trim();
      // Normalize bullet style to markdown dash
      if (/^[•+]\s/.test(trimmed)) {
        output.push(`- ${trimmed.substring(2)}`);
      } else {
        output.push(trimmed);
      }
      continue;
    }

    // Heading candidates — short line before longer text
    if (isHeadingCandidate(line.trim(), nextLine)) {
      output.push('');
      output.push(`## ${line.trim()}`);
      continue;
    }

    // Regular line
    output.push(line);
  }

  return output
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
