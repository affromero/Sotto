import { logger } from './logger';

const HEYGEN_API_BASE = 'https://api.heygen.com';

/** HTTP status codes that are never worth retrying (client errors: bad request, auth, billing, not found). */
const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 402, 403, 404]);

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
 * Thrown for HeyGen errors that should never be retried (billing, auth, credits).
 * The avatar-generation worker catches this and wraps it in BullMQ's UnrecoverableError.
 */
export class HeyGenBillingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HeyGenBillingError';
  }
}

/** Returns true if the error is a billing/credit/auth issue that retrying cannot fix. */
export function isNonRetryableHeyGenError(error: unknown): boolean {
  if (error instanceof HeyGenBillingError) return true;
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return NON_RETRYABLE_PATTERNS.some((p) => msg.includes(p));
}

export interface HeyGenAvatar {
  avatar_id: string;
  avatar_name: string;
  preview_image_url: string;
  preview_video_url?: string;
  gender: string;
  premium: boolean;
}

export async function listAvatars(apiKey: string): Promise<HeyGenAvatar[]> {
  const res = await fetch(`${HEYGEN_API_BASE}/v2/avatars`, {
    headers: { 'x-api-key': apiKey },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'unknown');
    throw new Error(`HeyGen list avatars failed (${res.status}): ${text}`);
  }

  const body = (await res.json()) as { data: { avatars: HeyGenAvatar[] } };
  return body.data.avatars;
}

export async function submitAvatarVideo(params: {
  apiKey: string;
  avatarId: string;
  audioUrl: string;
}): Promise<string> {
  const res = await fetch(`${HEYGEN_API_BASE}/v2/video/generate`, {
    method: 'POST',
    headers: {
      'x-api-key': params.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      video_inputs: [
        {
          character: {
            type: 'avatar',
            avatar_id: params.avatarId,
            avatar_style: 'closeUp',
          },
          voice: {
            type: 'audio',
            audio_url: params.audioUrl,
          },
          background: {
            type: 'color',
            value: '#00FF00',
          },
        },
      ],
      dimension: { width: 720, height: 720 },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'unknown');
    if (NON_RETRYABLE_STATUS_CODES.has(res.status)) {
      throw new HeyGenBillingError(`HeyGen submit failed (${res.status}): ${text}`);
    }
    throw new Error(`HeyGen submit failed (${res.status}): ${text}`);
  }

  const body = (await res.json()) as { data: { video_id: string } };
  return body.data.video_id;
}

export async function pollAvatarVideo(params: {
  apiKey: string;
  videoId: string;
  maxPollAttempts?: number;
  pollIntervalMs?: number;
}): Promise<{ videoUrl: string }> {
  const maxAttempts = params.maxPollAttempts ?? 180; // 15 min at 5s intervals
  const interval = params.pollIntervalMs ?? 5000;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, interval));

    const res = await fetch(
      `${HEYGEN_API_BASE}/v1/video_status.get?video_id=${params.videoId}`,
      { headers: { 'x-api-key': params.apiKey } },
    );

    if (!res.ok) {
      logger.warn('HeyGen poll status request failed', { status: res.status, attempt: i });
      continue;
    }

    const body = (await res.json()) as {
      data: { status: string; video_url?: string; error?: string };
    };

    if (body.data.status === 'completed' && body.data.video_url) {
      return { videoUrl: body.data.video_url };
    }

    if (body.data.status === 'failed') {
      const errorDetail = typeof body.data.error === 'object' ? JSON.stringify(body.data.error) : (body.data.error ?? 'unknown');
      const msg = `HeyGen video generation failed: ${errorDetail}`;
      if (NON_RETRYABLE_PATTERNS.some((p) => errorDetail.toLowerCase().includes(p))) {
        throw new HeyGenBillingError(msg);
      }
      throw new Error(msg);
    }
  }

  throw new Error(`HeyGen video generation timed out after ${maxAttempts} poll attempts`);
}

export async function generateAvatarVideo(params: {
  apiKey: string;
  avatarId: string;
  audioUrl: string;
}): Promise<Buffer> {
  const videoId = await submitAvatarVideo(params);
  const { videoUrl } = await pollAvatarVideo({ apiKey: params.apiKey, videoId });

  const res = await fetch(videoUrl);
  if (!res.ok) {
    throw new Error(`Failed to download HeyGen video: ${res.status}`);
  }

  return Buffer.from(await res.arrayBuffer());
}
