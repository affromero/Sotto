import { logger } from './logger';

const RUNWAY_API_BASE = 'https://api.dev.runwayml.com/v1';
const RUNWAY_VERSION_HEADER = '2024-11-06';

/** HTTP status codes that are never worth retrying (client errors: bad request, auth, billing). */
const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 402, 403]);

/** Error message substrings that indicate credit/billing exhaustion. */
const NON_RETRYABLE_PATTERNS = [
  'insufficient_credits',
  'insufficient credits',
  'payment required',
  'quota exceeded',
  'billing',
  'subscription expired',
  'plan limit',
  'no remaining credits',
];

/**
 * Thrown for Runway errors that should never be retried (billing, auth, credits).
 * The avatar-generation worker catches this and wraps it in BullMQ's UnrecoverableError.
 */
export class RunwayBillingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunwayBillingError';
  }
}

/** Returns true if the error is a billing/credit/auth issue that retrying cannot fix. */
export function isNonRetryableRunwayError(error: unknown): boolean {
  if (error instanceof RunwayBillingError) return true;
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return NON_RETRYABLE_PATTERNS.some((p) => msg.includes(p));
}

export interface RunwayAvatar {
  id: string;
  name: string;
  personality: string;
  startScript: string;
  referenceImageUri: string;
  processedImageUri: string;
  status: string;
  voice: unknown;
  documentIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type RunwayPresetId =
  | 'influencer'
  | 'game-character'
  | 'game-character-man'
  | 'music-superstar'
  | 'cat-character'
  | 'tennis-coach'
  | 'human-resource'
  | 'fashion-designer'
  | 'cooking-teacher';

export interface RunwaySessionCredentials {
  url: string; // wss://demo-xxx.livekit.cloud
  token: string; // LiveKit JWT
  roomName: string;
}

function runwayHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'X-Runway-Version': RUNWAY_VERSION_HEADER,
    'Content-Type': 'application/json',
  };
}

/**
 * List custom avatars via the Runway API (paginated).
 * Returns only user-created avatars — presets are not listed via this endpoint.
 */
export async function listRunwayAvatars(apiKey: string): Promise<RunwayAvatar[]> {
  const avatars: RunwayAvatar[] = [];
  let cursor: string | undefined;

  for (;;) {
    const url = new URL(`${RUNWAY_API_BASE}/avatars`);
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('starting_after', cursor);

    const res = await fetch(url.toString(), { headers: runwayHeaders(apiKey) });

    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown');
      if (NON_RETRYABLE_STATUS_CODES.has(res.status)) {
        throw new RunwayBillingError(`Runway list avatars failed (${res.status}): ${text}`);
      }
      throw new Error(`Runway list avatars failed (${res.status}): ${text}`);
    }

    const body = (await res.json()) as { data: RunwayAvatar[]; has_more: boolean };
    avatars.push(...body.data);

    if (!body.has_more || body.data.length === 0) break;
    cursor = body.data[body.data.length - 1].id;
  }

  return avatars;
}

/** Runway's CDN base for preset avatar images. */
const RUNWAY_PRESET_CDN = 'https://runway-static-assets.s3.us-east-1.amazonaws.com/calliope-demo/presets-3-3';

/** Fallback thumbnail for presets without official portal images (API-only presets). */
const RUNWAY_PLACEHOLDER = 'https://d3phaj0sisr2ct.cloudfront.net/devportal/models-v2/gwm-1-avatars.jpg';

const RUNWAY_PRESETS: Array<{ id: RunwayPresetId; name: string; previewImageUrl: string }> = [
  // 4 portal presets — real thumbnails from Runway CDN
  { id: 'cat-character', name: 'Mochi — Animal Character', previewImageUrl: `${RUNWAY_PRESET_CDN}/InApp_Avatar_4_input.png` },
  { id: 'music-superstar', name: 'Mina — Music Superstar', previewImageUrl: `${RUNWAY_PRESET_CDN}/InApp_Avatar_2.png` },
  { id: 'fashion-designer', name: 'Sofia — Fashion Designer', previewImageUrl: `${RUNWAY_PRESET_CDN}/Dev-Avatar-3_input.png` },
  { id: 'cooking-teacher', name: 'Marco — Cooking Teacher', previewImageUrl: `${RUNWAY_PRESET_CDN}/Dev-Avatar-4.png` },
  // 5 API-only presets — valid via Runway API but no official portal thumbnails
  { id: 'influencer', name: 'Influencer', previewImageUrl: RUNWAY_PLACEHOLDER },
  { id: 'game-character', name: 'Game Character', previewImageUrl: RUNWAY_PLACEHOLDER },
  { id: 'game-character-man', name: 'Game Character (Male)', previewImageUrl: RUNWAY_PLACEHOLDER },
  { id: 'tennis-coach', name: 'Tennis Coach', previewImageUrl: RUNWAY_PLACEHOLDER },
  { id: 'human-resource', name: 'Human Resource', previewImageUrl: RUNWAY_PLACEHOLDER },
];

/** Static list of Runway preset avatars — no API call needed. */
export function listRunwayPresets(): Array<{ id: RunwayPresetId; name: string; previewImageUrl: string }> {
  return RUNWAY_PRESETS;
}

/**
 * Create a realtime session. Returns the session ID.
 */
export async function createRealtimeSession(params: {
  apiKey: string;
  avatarId: string;
  isPreset: boolean;
  maxDuration?: number;
}): Promise<string> {
  const avatar = params.isPreset
    ? { type: 'runway-preset', presetId: params.avatarId }
    : { type: 'custom', avatarId: params.avatarId };

  const body: Record<string, unknown> = { model: 'gwm1_avatars', avatar };
  if (params.maxDuration) body.maxDuration = params.maxDuration;

  const res = await fetch(`${RUNWAY_API_BASE}/realtime_sessions`, {
    method: 'POST',
    headers: runwayHeaders(params.apiKey),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'unknown');
    if (NON_RETRYABLE_STATUS_CODES.has(res.status)) {
      throw new RunwayBillingError(`Runway create session failed (${res.status}): ${text}`);
    }
    throw new Error(`Runway create session failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { id: string };
  logger.info('Runway realtime session created', { sessionId: data.id });
  return data.id;
}

/**
 * Poll a realtime session until READY. Returns the sessionKey (JWT).
 */
export async function pollSessionReady(params: {
  apiKey: string;
  sessionId: string;
  maxPollAttempts?: number;
  pollIntervalMs?: number;
}): Promise<string> {
  const maxAttempts = params.maxPollAttempts ?? 60;
  const interval = params.pollIntervalMs ?? 5000;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, interval));

    const res = await fetch(`${RUNWAY_API_BASE}/realtime_sessions/${params.sessionId}`, {
      headers: runwayHeaders(params.apiKey),
    });

    if (!res.ok) {
      logger.warn('Runway poll session request failed', { status: res.status, attempt: i });
      continue;
    }

    const body = (await res.json()) as { status: string; sessionKey?: string; error?: string };

    if (body.status === 'READY' && body.sessionKey) {
      return body.sessionKey;
    }

    if (body.status === 'FAILED') {
      const errorDetail = body.error ?? 'unknown';
      const msg = `Runway session failed: ${errorDetail}`;
      if (NON_RETRYABLE_PATTERNS.some((p) => errorDetail.toLowerCase().includes(p))) {
        throw new RunwayBillingError(msg);
      }
      throw new Error(msg);
    }
  }

  throw new Error(`Runway session timed out after ${maxAttempts} poll attempts`);
}

/**
 * Consume a READY session — returns LiveKit credentials.
 */
export async function consumeSession(params: {
  sessionKey: string;
  sessionId: string;
}): Promise<RunwaySessionCredentials> {
  const res = await fetch(`${RUNWAY_API_BASE}/realtime_sessions/${params.sessionId}/consume`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.sessionKey}`,
      'X-Runway-Version': RUNWAY_VERSION_HEADER,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'unknown');
    throw new Error(`Runway consume session failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as RunwaySessionCredentials;
  return data;
}

/**
 * Delete a realtime session (cleanup — prevent orphaned sessions consuming credits).
 */
export async function deleteSession(params: {
  apiKey: string;
  sessionId: string;
}): Promise<void> {
  try {
    await fetch(`${RUNWAY_API_BASE}/realtime_sessions/${params.sessionId}`, {
      method: 'DELETE',
      headers: runwayHeaders(params.apiKey),
    });
  } catch (err) {
    logger.warn('Failed to delete Runway session', {
      sessionId: params.sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
