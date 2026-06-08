import { containsBlockedModerationTerm, looksLikeSottoImpersonation } from './local-moderation';
import { validateDisplayName } from './name-validation';

/**
 * Local display-name moderation for onboarding/profile updates.
 */
export function moderateDisplayName(name: string): { valid: boolean; reason?: string } {
  const formatCheck = validateDisplayName(name);
  if (!formatCheck.valid) {
    return formatCheck;
  }

  if (containsBlockedModerationTerm(name) || looksLikeSottoImpersonation(name)) {
    return { valid: false, reason: 'This name contains inappropriate content' };
  }

  return { valid: true };
}
