import { logger } from './logger';

const RETRY_DELAYS_MS = [2000, 4000, 8000, 16000];

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

export async function replicateFetch(url: string, options?: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const response = await fetch(url, options);
    if (response.status !== 429) {
      return response;
    }

    const bodyText = await response.text();
    if (attempt === RETRY_DELAYS_MS.length) {
      throw createReplicateFetchError(response.status, bodyText);
    }

    logger.warn('Replicate API rate limited, retrying', {
      attempt: attempt + 1,
      delayMs: RETRY_DELAYS_MS[attempt],
      status: response.status,
      url,
    });

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
  }

  throw new Error('Unreachable');
}
