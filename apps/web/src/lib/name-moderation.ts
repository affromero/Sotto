import { createAIProvider } from './providers/ai';
import { resolveAutoModel } from './auto-model-config';
import { logUsage } from './usage-logger';
import { logger } from './logger';

/**
 * Use the platform LLM to classify whether a name is inappropriate.
 * Server-side only. Fail-open: if the LLM is unavailable, allow through.
 */
export async function moderateDisplayName(name: string): Promise<{ valid: boolean; reason?: string }> {
  try {
    const autoConfig = await resolveAutoModel('PLATFORM');
    const response = await createAIProvider(autoConfig.aiProvider).generateResponse(
      'You are a content moderator. Given a display name, respond with ONLY "ok" if it is acceptable, or "reject" if it is obscene, offensive, a slur, sexually explicit, or impersonating a public figure. Be lenient with creative/unusual names — only reject clearly inappropriate ones.',
      [{ role: 'user', content: name }],
      { maxTokens: 5, model: autoConfig.aiModel, skipModeration: true },
    );

    logUsage({
      service: autoConfig.aiProvider,
      model: response.model,
      category: 'name_moderation',
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
    });

    const answer = response.content.trim().toLowerCase();
    if (answer.startsWith('reject')) {
      return { valid: false, reason: 'This name contains inappropriate content' };
    }
    return { valid: true };
  } catch (error) {
    logger.warn('Name moderation failed, allowing through', { error });
    return { valid: true };
  }
}
