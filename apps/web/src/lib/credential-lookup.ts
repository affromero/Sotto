import { generateResponse, WEB_SEARCH_TOOL } from './claude';
import { logger } from './logger';
import { logUsage } from './usage-logger';

export interface ParticipantInput {
  authorUsername: string;
  authorName: string;
  authorBio?: string;
  authorVerifiedType?: string;
}

export interface ParticipantCredential {
  username: string;
  name: string;
  credentials: string;
  confidence: number;
  source: string;
}

const MAX_PARTICIPANTS = 5;
const MIN_CONFIDENCE = 0.8;
const MAX_CONFIDENCE = 0.85;

const SYSTEM_PROMPT = `You are a credential verification agent. Your job is to verify the real-world identity and credentials of Twitter/X participants.

For each participant provided:
1. Search the web for their name and Twitter handle
2. Cross-reference their Twitter bio against what you find
3. Only return credentials you can verify from a credible source (university faculty page, LinkedIn, company about page, Wikipedia, news articles)
4. Return null credentials if uncertain — better to omit than misattribute
5. Include the source URL or description where you found the credentials

Return ONLY valid JSON matching this shape:
{
  "participants": [
    {
      "username": "drsmith",
      "credentials": "Professor of Physics at MIT",
      "confidence": 0.85,
      "source": "MIT faculty page"
    }
  ]
}

If a participant cannot be verified, omit them from the array entirely.
Return ONLY the JSON object.`;

/**
 * Look up real-world credentials for verified Twitter participants via Claude + web search.
 * Returns only high-confidence results (>= 0.8). Caps at 5 participants to limit API cost.
 * Gracefully returns empty array on any error.
 */
export async function lookupParticipantCredentials(
  participants: ParticipantInput[],
  apiKeyOverride?: string
): Promise<ParticipantCredential[]> {
  if (participants.length === 0) return [];

  const capped = participants.slice(0, MAX_PARTICIPANTS);

  const participantDescriptions = capped.map((p) => {
    const parts = [`- @${p.authorUsername} (${p.authorName})`];
    if (p.authorBio) parts.push(`  Bio: "${p.authorBio}"`);
    if (p.authorVerifiedType) parts.push(`  Verified type: ${p.authorVerifiedType}`);
    return parts.join('\n');
  });

  const userMessage = `Verify the credentials of these Twitter/X participants:\n\n${participantDescriptions.join('\n\n')}`;

  try {
    const response = await generateResponse(
      SYSTEM_PROMPT,
      [{ role: 'user', content: userMessage }],
      {
        maxTokens: 2048,
        apiKeyOverride,
        tools: [WEB_SEARCH_TOOL],
        skipModeration: true,
      }
    );

    logUsage({
      service: 'anthropic',
      model: response.model,
      category: 'credential_lookup',
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
    });

    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('Credential lookup returned no JSON');
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      participants: Array<{
        username: string;
        credentials: string | null;
        confidence: number;
        source: string;
      }>;
    };

    const nameMap = new Map(capped.map((p) => [p.authorUsername.toLowerCase(), p.authorName]));

    return (parsed.participants ?? [])
      .filter((p) => p.credentials && p.confidence >= MIN_CONFIDENCE)
      .map((p) => ({
        username: p.username,
        name: nameMap.get(p.username.toLowerCase()) ?? p.username,
        credentials: p.credentials!,
        confidence: Math.min(p.confidence, MAX_CONFIDENCE),
        source: p.source,
      }));
  } catch (err) {
    logger.error('Credential lookup failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
