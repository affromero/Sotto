import { logger } from './logger';

const MAX_RETRIES = 4;
const DEFAULT_RETRY_DELAY_MS = 8000;

type ReplicateFetchError = Error & {
  bodyText: string;
  status: number;
};

function createReplicateFetchError(status: number, bodyText: string): ReplicateFetchError {
  const error = new Error(`Replicate API error (${status}): ${bodyText}`) as ReplicateFetchError;
  error.name = 'ReplicateFetchError';
  error.status = status;
  error.bodyText = bodyText;
  return error;
}

function parseRetryAfter(bodyText: string): number {
  try {
    const parsed = JSON.parse(bodyText);
    if (typeof parsed.retry_after === 'number' && parsed.retry_after > 0) {
      return Math.ceil(parsed.retry_after * 1000);
    }
    const match = typeof parsed.detail === 'string' && parsed.detail.match(/resets in ~(\d+)s/);
    if (match) return parseInt(match[1], 10) * 1000;
  } catch {}
  return DEFAULT_RETRY_DELAY_MS;
}

export async function replicateFetch(url: string, options?: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(url, options);
    if (response.status !== 429) {
      return response;
    }

    const bodyText = await response.text();
    if (attempt === MAX_RETRIES) {
      throw createReplicateFetchError(response.status, bodyText);
    }

    const delayMs = parseRetryAfter(bodyText);

    logger.warn('Replicate API rate limited, retrying', {
      attempt: attempt + 1,
      delayMs,
      status: response.status,
      url,
    });

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error('Unreachable');
}
