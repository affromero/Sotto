import { logger } from '@/lib/logger';

const CARTESIA_BASE_URL = 'https://api.cartesia.ai';
const CARTESIA_VERSION = '2025-04-16';

/**
 * Clone a voice via Cartesia's instant voice cloning API.
 */
export async function cloneVoiceViaCartesia(
  apiKey: string,
  audioBuffer: Buffer,
  name: string,
  options?: { enhance?: boolean; language?: string }
): Promise<{ voiceId: string }> {
  const formData = new FormData();
  const uint8 = new Uint8Array(audioBuffer);
  const blob = new Blob([uint8], { type: 'audio/mpeg' });
  formData.append('clip', blob, 'sample.mp3');
  formData.append('name', name);
  if (options?.enhance) {
    formData.append('enhance', 'true');
  }
  if (options?.language) {
    formData.append('language', options.language);
  }

  const response = await fetch(`${CARTESIA_BASE_URL}/voices/clone`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Cartesia-Version': CARTESIA_VERSION,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cartesia voice clone error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  logger.info('Voice cloned via Cartesia', { name, voiceId: data.id });
  return { voiceId: data.id };
}

/**
 * Delete a cloned voice from Cartesia.
 */
export async function deleteCartesiaVoice(
  apiKey: string,
  voiceId: string
): Promise<void> {
  const response = await fetch(`${CARTESIA_BASE_URL}/voices/${voiceId}`, {
    method: 'DELETE',
    headers: {
      'X-API-Key': apiKey,
      'Cartesia-Version': CARTESIA_VERSION,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cartesia voice deletion error (${response.status}): ${errorText}`);
  }

  logger.info('Cartesia voice deleted', { voiceId });
}
