import { createAIProvider } from './providers/ai';
import { loadPrompt } from './prompt-loader';
import { logger } from './logger';
import { logUsage } from './usage-logger';
import { resolveAutoModel } from './auto-model-config';

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

const SYSTEM_PROMPT = loadPrompt('credential-lookup.md');

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
    const autoConfig = await resolveAutoModel('PLATFORM');

    const response = await createAIProvider(autoConfig.aiProvider).generateResponse(
      SYSTEM_PROMPT,
      [{ role: 'user', content: userMessage }],
      {
        maxTokens: 2048,
        model: autoConfig.aiModel,
        apiKeyOverride,
        useWebSearch: true,
        skipModeration: true,
      }
    );

    logUsage({
      service: autoConfig.aiProvider,
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
