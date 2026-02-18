/**
 * Fal.ai voice cloning via Qwen3-TTS clone-voice endpoint.
 *
 * Uploads audio to R2 for a public URL, then calls Fal's clone-voice API
 * to generate a speaker embedding (safetensors file). The embedding URL
 * is stored as `externalVoiceId` in the VoiceClone model.
 */
import { uploadFile } from './r2';
import { logger } from './logger';
import { randomUUID } from 'crypto';

interface FalCloneResponse {
  speaker_embedding: { url: string };
}

/**
 * Clone a voice via Fal's Qwen3-TTS clone-voice endpoint.
 *
 * @returns The speaker embedding URL (used as externalVoiceId for Fal TTS)
 */
export async function cloneVoiceViaFal(
  apiKey: string,
  audioBuffer: Buffer,
  referenceText?: string
): Promise<{ embeddingUrl: string }> {
  // Step 1: Upload audio to R2 so Fal can fetch it via URL
  const key = `voice-clones/fal/${randomUUID()}.mp3`;
  const audioUrl = await uploadFile(key, audioBuffer, 'audio/mpeg');

  // Step 2: Call Fal clone-voice endpoint
  const body: Record<string, unknown> = { audio_url: audioUrl };
  if (referenceText) {
    body.reference_text = referenceText;
  }

  const response = await fetch('https://fal.run/fal-ai/qwen-3-tts/clone-voice/1.7b', {
    method: 'POST',
    headers: {
      Authorization: `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Fal clone-voice error (${response.status}): ${errorText}`);
  }

  const data: FalCloneResponse = await response.json();
  if (!data.speaker_embedding?.url) {
    throw new Error('Fal clone-voice returned no speaker embedding URL');
  }

  logger.info('Fal voice cloned', { embeddingUrl: data.speaker_embedding.url });
  return { embeddingUrl: data.speaker_embedding.url };
}
