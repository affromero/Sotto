import { generateResponse } from './llm';
import { loadPrompt } from './prompt-loader';
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

const SYSTEM_PROMPT = loadPrompt('topic-assessor.md');

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
