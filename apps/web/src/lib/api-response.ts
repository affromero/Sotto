import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

/**
 * Generate a short request ID for error tracking.
 * Format: req_<12 hex chars> (e.g., req_a1b2c3d4e5f6)
 */
function generateRequestId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `req_${hex}`;
}

/**
 * Return a JSON error response with a requestId for tracking.
 *
 * Logs the error server-side with the requestId so it can be correlated
 * with user-reported issues.
 *
 * @example
 *   // Simple error
 *   return errorResponse('Unauthorized', 401);
 *
 *   // With extra fields
 *   return errorResponse('Rate limit exceeded', 429, { resetAt: rateLimit.resetAt });
 *
 *   // With validation details
 *   return errorResponse('Invalid input', 400, { details: parsed.error.flatten() });
 */
export function errorResponse(
  error: string | Record<string, unknown>,
  status: number,
  meta?: Record<string, unknown>,
  headers?: Record<string, string>
): NextResponse {
  const requestId = generateRequestId();

  const body = {
    error,
    requestId,
    ...meta,
  };

  if (status >= 500) {
    logger.error(`[${requestId}] ${typeof error === 'string' ? error : JSON.stringify(error)}`, {
      status: String(status),
      ...meta,
    });
  } else if (status >= 400 && status !== 401 && status !== 404) {
    logger.warn(`[${requestId}] Client error`, {
      status: String(status),
      error: typeof error === 'string' ? error : 'object',
      ...meta,
    });
  }

  return NextResponse.json(body, {
    status,
    headers: { 'x-request-id': requestId, ...headers },
  });
}
