import type { z } from 'zod';

export class PlayHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'PlayHttpError';
  }
}

export async function playFetch<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  options: {
    body?: unknown;
    signal?: AbortSignal;
    proof?: string;
    keepalive?: boolean;
    expectedProfileId?: string;
  } = {}
): Promise<z.infer<Schema>> {
  if (!path.startsWith('/api/v1/play/')) throw new Error('Invalid game endpoint.');
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: options.signal,
      keepalive: options.keepalive,
      headers: {
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.proof ? { 'X-Sotto-Play-Proof': options.proof } : {}),
        ...(options.expectedProfileId ? { 'X-Sotto-Play-Profile': options.expectedProfileId } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new PlayHttpError(0, 'Connection lost. Your draft is still here.');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error.slice(0, 500)
        : 'The game is unavailable. Try again.';
    throw new PlayHttpError(response.status, message);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new PlayHttpError(0, 'The game response was incomplete. Reconnect to check its state.');
  return parsed.data;
}

export function playErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The game is unavailable. Try again.';
}

export function newPlayProof() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** getRandomValues also works on local HTTP origins that lack randomUUID. */
export function newPlayActionId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const value = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
