/**
 * Replicate lip-sync — submit prediction → poll → download.
 * Supports VEED Fabric, Wav2Lip, and SadTalker models.
 */
import { logger } from '@/lib/logger';
import { replicateFetch } from './replicate-fetch';

export interface ReplicateLipSyncParams {
  modelId: string;
  imageUrl: string;
  audioUrl: string;
  apiKey: string;
}

export interface ReplicateLipSyncResult {
  videoUrl: string;
}

/** Map pricetoken avatar model IDs to Replicate model paths. */
const REPLICATE_AVATAR_PATHS: Record<string, string> = {
  'replicate-veed-fabric-480p': 'veed/fabric-1.0',
  'replicate-veed-fabric-720p': 'veed/fabric-1.0',
  'replicate-wav2lip': 'devxpy/cog-wav2lip',
  'replicate-sadtalker': 'cjwbw/sadtalker',
};

/** Max audio duration in seconds per model. */
export const REPLICATE_LIP_SYNC_CONFIG: Record<string, { maxAudioSeconds: number }> = {
  'replicate-veed-fabric-480p': { maxAudioSeconds: 300 },
  'replicate-veed-fabric-720p': { maxAudioSeconds: 300 },
  'replicate-wav2lip': { maxAudioSeconds: 120 },
  'replicate-sadtalker': { maxAudioSeconds: 60 },
};

/** Build model-specific input for Replicate prediction. */
function buildLipSyncInput(
  modelId: string,
  imageUrl: string,
  audioUrl: string,
): Record<string, unknown> {
  if (modelId.startsWith('replicate-veed-fabric')) {
    const resolution = modelId.includes('720p') ? '720p' : '480p';
    return { image: imageUrl, audio: audioUrl, resolution };
  }

  if (modelId === 'replicate-wav2lip') {
    return { face: imageUrl, audio: audioUrl };
  }

  if (modelId === 'replicate-sadtalker') {
    return { source_image: imageUrl, driven_audio: audioUrl };
  }

  throw new Error(`Unknown Replicate lip-sync model: ${modelId}`);
}

interface ReplicatePrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output: string | string[] | null;
  error: string | null;
}

export async function submitReplicateLipSync(
  params: ReplicateLipSyncParams,
): Promise<{ predictionId: string }> {
  const { modelId, imageUrl, audioUrl, apiKey } = params;

  const modelPath = REPLICATE_AVATAR_PATHS[modelId];
  if (!modelPath) throw new Error(`No Replicate path for avatar model: ${modelId}`);

  const input = buildLipSyncInput(modelId, imageUrl, audioUrl);

  logger.info('Submitting Replicate lip-sync prediction', { modelId, modelPath });

  let response: Response;
  try {
    response = await replicateFetch(
      `https://api.replicate.com/v1/models/${modelPath}/predictions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Prefer: 'wait',
        },
        body: JSON.stringify({ input }),
      },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === 'ReplicateFetchError' &&
      'status' in error &&
      'bodyText' in error
    ) {
      throw new Error(
        `Replicate lip-sync submission failed (${String(error.status)}): ${String(error.bodyText)}`,
      );
    }
    throw error;
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Replicate lip-sync submission failed (${response.status}): ${errorText}`);
  }

  const prediction: ReplicatePrediction = await response.json();

  if (prediction.status === 'succeeded') {
    const videoUrl = extractVideoUrl(prediction.output);
    if (!videoUrl) throw new Error('Replicate lip-sync returned no video output');
    // Return predictionId — caller will use pollReplicateLipSync which also handles already-succeeded
    return { predictionId: prediction.id };
  }

  if (prediction.status === 'failed') {
    throw new Error(`Replicate lip-sync prediction failed: ${prediction.error}`);
  }

  return { predictionId: prediction.id };
}

export async function pollReplicateLipSync(
  predictionId: string,
  apiKey: string,
  timeoutMs: number,
): Promise<ReplicateLipSyncResult> {
  const pollIntervalMs = 3000;
  const maxAttempts = Math.ceil(timeoutMs / pollIntervalMs);

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));

    const response = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      logger.warn('Replicate lip-sync poll failed', { status: response.status, attempt: i });
      continue;
    }

    const prediction: ReplicatePrediction = await response.json();

    if (prediction.status === 'succeeded') {
      const videoUrl = extractVideoUrl(prediction.output);
      if (!videoUrl) throw new Error('Replicate lip-sync returned no video output');
      return { videoUrl };
    }

    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      throw new Error(`Replicate lip-sync prediction failed: ${prediction.error ?? prediction.status}`);
    }
  }

  throw new Error(`Replicate lip-sync timed out after ${Math.round(timeoutMs / 1000)}s`);
}

function extractVideoUrl(output: string | string[] | null): string | null {
  if (!output) return null;
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) return output[0] ?? null;
  return null;
}
