import { generateResponse, streamResponse } from './claude';

/**
 * System prompt for the discovery chat agent
 */
const DISCOVERY_SYSTEM_PROMPT = `You are Sotto's podcast discovery agent. Your job is to have a natural conversation
to understand what the user wants to learn, then produce structured metadata for podcast generation.

You are warm, curious, and conversational — like a knowledgeable friend who's genuinely excited to help.

## Your conversation flow:
1. Ask about the TOPIC they're curious about
2. Ask about AUDIENCE — who will be listening? (kids 6-10, teens 11-16, family-friendly, general, mature/unfiltered)
3. Ask about DEPTH (quick overview, standard, deep dive)
4. Ask about their BACKGROUND/AUDIENCE LEVEL (beginner, some knowledge, expert)
5. Ask about FOCUS — what specific angle interests them
6. Ask about TONE (casual, professional, socratic/questioning)
7. Optionally ask about DURATION preference

## Rules:
- Ask ONE question at a time
- Suggest 2-4 chip options for each question (in [chips: option1 · option2 · option3] format)
- Accept free-text answers too — adapt your follow-ups based on what they say
- If the user is an expert, skip basic questions
- After gathering enough info (usually 3-5 exchanges), summarize what you'll create and ask for confirmation
- Be concise — this is a mobile-first app used while commuting

## Output format for chips:
Include suggested quick-reply options at the end of your message:
[chips: Option A · Option B · Option C]

## When complete:
End your final message with a metadata block:
[METADATA]
{
  "topic": "...",
  "depth": "quick_overview|standard|deep_dive",
  "audience_level": "beginner|intermediate|expert",
  "audience": "kids|teens|family|general|mature",
  "focus_areas": ["...", "..."],
  "tone": "casual|professional|socratic",
  "duration_target": 10,
  "ready": true
}
[/METADATA]`;

/**
 * Parse chip suggestions from agent message
 */
export function parseChips(message: string): { text: string; chips: string[] } {
  const chipMatch = message.match(/\[chips:\s*(.+?)\]/);
  if (!chipMatch) {
    return { text: message, chips: [] };
  }

  const chips = chipMatch[1].split('·').map((c) => c.trim());
  const text = message.replace(/\[chips:\s*.+?\]/, '').trim();

  return { text, chips };
}

/**
 * Parse metadata from agent's final message
 */
export function parseMetadata(
  message: string
): {
  topic: string;
  depth: string;
  audience_level: string;
  audience: string;
  focus_areas: string[];
  tone: string;
  duration_target: number;
  ready: boolean;
} | null {
  const metadataMatch = message.match(/\[METADATA\]\s*([\s\S]*?)\s*\[\/METADATA\]/);
  if (!metadataMatch) return null;

  try {
    return JSON.parse(metadataMatch[1]);
  } catch {
    return null;
  }
}

/**
 * Generate a discovery chat response (non-streaming)
 */
export async function getDiscoveryResponse(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  return generateResponse(DISCOVERY_SYSTEM_PROMPT, messages, { maxTokens: 1024 });
}

/**
 * Stream a discovery chat response
 */
export function streamDiscoveryResponse(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): AsyncGenerator<string> {
  return streamResponse(DISCOVERY_SYSTEM_PROMPT, messages, { maxTokens: 1024 });
}
