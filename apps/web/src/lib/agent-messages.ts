/** Convert a message array into a single prompt string for CLI-backed agents. */
export function serializeMessages(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): string {
  if (messages.length === 1) {
    return messages[0].content;
  }

  return messages
    .map((m) => {
      const label = m.role === 'user' ? 'USER' : 'ASSISTANT';
      return `${label}: ${m.content}`;
    })
    .join('\n\n---\n\n');
}
