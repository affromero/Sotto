/**
 * Classifies BullMQ job failure messages into actionable error categories.
 * Handles three distinct error formats:
 *   1. Fetch-based TTS providers: "{Provider} API error ({status}): {text}"
 *   2. Anthropic SDK: substrings like "authentication_error", "rate_limit_error"
 *   3. OpenAI SDK: "{status} {message}" e.g. "401 Unauthorized"
 */

export type ByokErrorKind =
  | 'auth_invalid'
  | 'insufficient_credits'
  | 'rate_limited'
  | 'provider_error'
  | 'unknown';

const FETCH_STATUS_RE = /API error \((\d{3})\)/;
const OPENAI_STATUS_RE = /^(\d{3})\s/;

function classifyByStatus(status: number): ByokErrorKind | null {
  if (status === 401 || status === 403) return 'auth_invalid';
  if (status === 402) return 'insufficient_credits';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'provider_error';
  return null;
}

export function classifyError(errorMessage: string): ByokErrorKind {
  if (!errorMessage) return 'unknown';

  // 1. Fetch-based providers: "ElevenLabs API error (401): ..."
  const fetchMatch = FETCH_STATUS_RE.exec(errorMessage);
  if (fetchMatch) {
    const result = classifyByStatus(parseInt(fetchMatch[1], 10));
    if (result) return result;
  }

  // 2. OpenAI SDK: "401 Unauthorized"
  const openaiMatch = OPENAI_STATUS_RE.exec(errorMessage);
  if (openaiMatch) {
    const result = classifyByStatus(parseInt(openaiMatch[1], 10));
    if (result) return result;
  }

  // 3. Anthropic SDK substring matching
  if (/authentication_error|invalid_api_key|invalid.*key/i.test(errorMessage)) {
    return 'auth_invalid';
  }
  if (/rate_limit/i.test(errorMessage)) {
    return 'rate_limited';
  }
  if (/insufficient|quota|credits|balance/i.test(errorMessage)) {
    return 'insufficient_credits';
  }

  return 'unknown';
}

/**
 * Check if an error indicates the API key lacks access to the requested resource.
 * Any 404 from a BYOK key is worth retrying with the platform key — the most
 * common case is ElevenLabs model access (e.g. eleven_v3), but generic 404s
 * from other providers should also trigger the fallback.
 */
export function isModelAccessError(errorMessage: string): boolean {
  return /\b404\b/.test(errorMessage);
}

export function isKeyInvalidationError(kind: ByokErrorKind): boolean {
  return kind === 'auth_invalid' || kind === 'insufficient_credits';
}

export function userMessage(kind: ByokErrorKind, providerLabel: string, stageLabel?: string): string {
  switch (kind) {
    case 'auth_invalid':
      return `Your ${providerLabel} API key is invalid or has been revoked. Update it in Settings.`;
    case 'insufficient_credits':
      return `Your ${providerLabel} account has insufficient credits.`;
    case 'rate_limited':
      return `Rate limited by ${providerLabel}. Try again shortly.`;
    case 'provider_error':
      return `${providerLabel} is experiencing issues. Try again later.`;
    case 'unknown': {
      const stage = stageLabel || 'Generation';
      return `${stage} failed. Please try again.`;
    }
  }
}
