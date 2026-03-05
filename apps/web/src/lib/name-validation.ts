const KEYBOARD_PATTERNS = [
  'qwerty', 'asdf', 'zxcv', 'qwertz', 'azerty',
  'hjkl', 'uiop', 'bnm', 'wasd',
];

/**
 * Validate a display name for gibberish / low-quality input.
 * Pure function — no async, safe for client-side mirroring.
 */
export function validateDisplayName(name: string): { valid: boolean; reason?: string } {
  const trimmed = name.trim();

  if (trimmed.length < 2) {
    return { valid: false, reason: 'Name must be at least 2 characters' };
  }
  if (trimmed.length > 100) {
    return { valid: false, reason: 'Name must be 100 characters or fewer' };
  }

  // All same character repeated
  if (/^(.)\1+$/.test(trimmed)) {
    return { valid: false, reason: 'Please enter a real name' };
  }

  // Only numbers or symbols (no letters at all)
  if (!/\p{Letter}/u.test(trimmed)) {
    return { valid: false, reason: 'Name must contain at least one letter' };
  }

  // Keyboard smash detection
  const lower = trimmed.toLowerCase().replace(/[^a-z]/g, '');
  for (const pattern of KEYBOARD_PATTERNS) {
    if (lower.includes(pattern)) {
      return { valid: false, reason: 'Please enter a real name' };
    }
  }

  return { valid: true };
}

/**
 * Use the platform LLM to classify whether a name is inappropriate.
 * Server-side only. Fail-open: if the LLM is unavailable, allow through.
 */
export async function moderateDisplayName(name: string): Promise<{ valid: boolean; reason?: string }> {
  try {
    const { createAIProvider } = await import('./providers/ai');
    const { resolveAutoModel } = await import('./auto-model-config');
    const { logUsage } = await import('./usage-logger');

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
    const { logger } = await import('./logger');
    logger.warn('Name moderation failed, allowing through', { error });
    return { valid: true };
  }
}
