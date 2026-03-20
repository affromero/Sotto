import { getFalAvatarEndpoint } from '@/lib/providers/fal-endpoints';
import { logger } from '@/lib/logger';

export interface FalLipSyncParams {
  modelId: string;
  imageUrl: string;
  audioUrl: string;
  apiKey: string;
  prompt?: string;
}

export interface FalLipSyncResult {
  videoUrl: string;
  durationSeconds: number;
}

/**
 * Parse Fal's FastAPI 422 validation errors into a human-readable string.
 * Input: raw response text (may be JSON with `detail` array or plain text).
 * Output: "field_name: error message" or the raw text if unparseable.
 */
function parseFalValidationError(text: string): string {
  try {
    const json = JSON.parse(text) as {
      detail?: Array<{ loc?: (string | number)[]; msg?: string; type?: string }> | string;
    };
    if (Array.isArray(json.detail)) {
      return json.detail
        .map((d) => {
          const field = d.loc?.filter((l) => l !== 'body').join('.') || 'unknown';
          return `${field}: ${d.msg || 'validation error'}`;
        })
        .join('; ');
    }
    if (typeof json.detail === 'string') return json.detail;
  } catch {
    // Not JSON — return raw text
  }
  return text;
}

export async function submitFalLipSync(params: FalLipSyncParams): Promise<{ requestId: string; statusUrl: string; resultUrl: string }> {
  const { modelId, imageUrl, audioUrl, apiKey, prompt } = params;

  const endpoint = getFalAvatarEndpoint(modelId);
  if (!endpoint) throw new Error(`No Fal avatar endpoint for model: ${modelId}`);

  const url = `https://queue.fal.run/${endpoint}`;

  logger.info('Submitting fal lip-sync job', { modelId, endpoint });

  const body: Record<string, string> = {
    image_url: imageUrl,
    audio_url: audioUrl,
    resolution: '512',
  };
  if (prompt) body.prompt = prompt;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'unknown');
    // Parse FastAPI 422 validation errors to extract the failing field
    const detail = parseFalValidationError(text);
    throw new Error(`Fal lip-sync submission failed (${res.status}): ${detail}`);
  }

  const data = (await res.json()) as {
    request_id: string;
    status_url?: string;
    response_url?: string;
  };

  const { request_id } = data;
  const fallbackBase = `https://queue.fal.run/${endpoint}/requests/${request_id}`;
  const statusUrl = data.status_url ?? `${fallbackBase}/status`;
  const resultUrl =
    data.response_url ??
    (data.status_url ? data.status_url.replace(/\/status$/, '') : fallbackBase);

  logger.info('Fal lip-sync job submitted', { request_id, statusUrl });

  return { requestId: request_id, statusUrl, resultUrl };
}

export async function pollFalLipSync(
  statusUrl: string,
  resultUrl: string,
  apiKey: string,
  timeoutMs: number,
): Promise<FalLipSyncResult> {
  const pollIntervalMs = 5000;
  const maxAttempts = Math.ceil(timeoutMs / pollIntervalMs);

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));

    const statusRes = await fetch(statusUrl, {
      headers: { Authorization: `Key ${apiKey}` },
    });

    if (!statusRes.ok) {
      logger.warn('Fal lip-sync status poll failed', { status: statusRes.status, attempt: i });
      continue;
    }

    const status = (await statusRes.json()) as { status: string; error?: string; response_url?: string };

    if (status.status === 'COMPLETED') {
      const fetchUrl = status.response_url ?? resultUrl;
      const resultRes = await fetch(fetchUrl, {
        headers: { Authorization: `Key ${apiKey}` },
      });
      if (!resultRes.ok) {
        const text = await resultRes.text().catch(() => 'unknown');
        throw new Error(`Fal lip-sync result fetch failed (${resultRes.status}): ${text}`);
      }
      const result = (await resultRes.json()) as { video?: { url: string }; duration?: number };
      const videoUrl = result.video?.url;
      if (!videoUrl) throw new Error('Fal lip-sync returned no video URL');

      return {
        videoUrl,
        durationSeconds: result.duration ?? 0,
      };
    }

    if (status.status === 'FAILED') {
      const errorDetail = typeof status.error === 'string' ? status.error : JSON.stringify(status.error ?? 'unknown');
      throw new Error(`Fal lip-sync generation failed: ${errorDetail}`);
    }
  }

  throw new Error(`Fal lip-sync timed out after ${Math.round(timeoutMs / 1000)}s`);
}
