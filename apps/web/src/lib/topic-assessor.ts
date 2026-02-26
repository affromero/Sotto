import { generateResponse } from './claude';
import { logger } from './logger';

export type FeasibilityVerdict = 'proceed' | 'warn' | 'reject';

export interface FeasibilityAssessment {
  verdict: FeasibilityVerdict;
  reason: string;
  suggestion: string | null;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

const SYSTEM_PROMPT = `You are a topic feasibility screener for a podcast platform that requires factual claims to be backed by verifiable sources.

Your job: quickly assess whether a topic can produce a fact-based podcast with verifiable citations, or if it's inherently unverifiable.

## Classify the topic into one of three verdicts:

**PROCEED** — The topic has abundant verifiable information from reputable sources.
Examples: "quantum computing basics", "the history of the Roman Empire", "how mRNA vaccines work", "climate change impacts on agriculture"

**WARN** — The topic is partially verifiable but may struggle with sourcing. The podcast can still be made, but the user should know some claims may be hard to verify.
Examples: "the psychology of dreams", "theories about consciousness", "emerging trends in AI art", "the future of remote work"

**REJECT** — The topic is fundamentally unverifiable, relies on conspiracy theories, or would require fabricating sources.
Examples: "proof that the earth is flat", "how aliens built the pyramids", "the real illuminati agenda", "evidence that vaccines cause autism"

## Important distinctions:
- Opinion pieces and creative topics should WARN, not REJECT — they can be made with relaxed verification
- Topics about controversial but legitimate research should PROCEED — the controversy is itself well-documented
- "Explain both sides of X" topics should PROCEED — presenting perspectives is journalism
- Niche but factual topics should PROCEED even if sources are fewer — Wikipedia-level topics are fine
- Only REJECT topics that would require the AI to fabricate evidence or promote proven misinformation

## For WARN and REJECT verdicts, provide a suggestion:
Suggest how to reframe the topic to make it more verifiable. Be specific and constructive.

## Output format (JSON only):
{
  "verdict": "proceed" | "warn" | "reject",
  "reason": "Brief explanation (1-2 sentences)",
  "suggestion": "Reframed topic suggestion" | null
}

Return ONLY the JSON object.`;

export async function assessTopicFeasibility(params: {
  topic: string;
  sourceContent?: string;
  depth?: string;
  apiKeyOverride?: string;
  model?: string;
}): Promise<FeasibilityAssessment> {
  const { topic, sourceContent, depth } = params;

  const userMessage = [
    `Topic: ${topic}`,
    depth ? `Depth: ${depth}` : null,
    sourceContent ? `Source content available: ${sourceContent.length} characters (user provided a URL or text)` : 'No source content provided — topic only',
  ]
    .filter(Boolean)
    .join('\n');

  const response = await generateResponse(SYSTEM_PROMPT, [{ role: 'user', content: userMessage }], {
    maxTokens: 512,
    apiKeyOverride: params.apiKeyOverride,
    model: params.model,
    skipModeration: true,
  });

  try {
    const parsed = JSON.parse(response.content.trim());
    const verdict = parsed.verdict as FeasibilityVerdict;

    if (!['proceed', 'warn', 'reject'].includes(verdict)) {
      logger.warn('Topic assessor returned unexpected verdict, defaulting to proceed', {
        verdict: String(verdict),
        topic: topic.substring(0, 100),
      });
      return {
        verdict: 'proceed',
        reason: 'Assessment inconclusive — proceeding with standard verification.',
        suggestion: null,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        model: response.model,
      };
    }

    return {
      verdict,
      reason: parsed.reason || '',
      suggestion: parsed.suggestion || null,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      model: response.model,
    };
  } catch {
    logger.warn('Topic assessor response could not be parsed, defaulting to proceed', {
      topic: topic.substring(0, 100),
    });
    return {
      verdict: 'proceed',
      reason: 'Assessment inconclusive — proceeding with standard verification.',
      suggestion: null,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      model: response.model,
    };
  }
}
