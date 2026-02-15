import { Job } from 'bullmq';
import type { ValidateKeysPayload } from '@/lib/queue';
import { prisma } from '@/lib/prisma';
import { decryptApiKey } from '@/lib/byok';
import { validateProviderCredentials, type TtsProviderId } from '@/lib/providers/tts-registry';
import { validateAiProviderCredentials, type AiProviderId } from '@/lib/providers/ai-registry';
import { logger } from '@/lib/logger';

const THROTTLE_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function processKeyValidation(job: Job<ValidateKeysPayload>): Promise<void> {
  let ttsChecked = 0;
  let ttsInvalidated = 0;
  let aiChecked = 0;
  let aiInvalidated = 0;

  // Re-validate all TTS BYOK keys
  const ttsKeys = await prisma.userTtsKey.findMany({
    where: { isValid: true },
    select: { id: true, userId: true, provider: true, encryptedKey: true, extraData: true },
  });

  const notifQueue = (await import('@/lib/queue')).notificationQueue;

  for (const key of ttsKeys) {
    ttsChecked++;
    try {
      const apiKey = decryptApiKey(key.encryptedKey);
      const creds: Record<string, string> = { apiKey };
      if (key.extraData) {
        try {
          const extra = JSON.parse(decryptApiKey(key.extraData));
          if (extra.userId) creds.userId = extra.userId;
        } catch {
          // extra data decryption failure — skip extra
        }
      }

      const valid = await validateProviderCredentials(key.provider as TtsProviderId, creds);
      if (!valid) {
        await prisma.userTtsKey.update({
          where: { id: key.id },
          data: { isValid: false },
        });
        ttsInvalidated++;

        await notifQueue.add('send_notification', {
          userId: key.userId,
          type: 'KEY_INVALID',
          title: 'TTS Key Invalid',
          message: `Your ${key.provider} API key is no longer valid. Update it in Settings.`,
          data: {},
        });
      }
    } catch (err) {
      logger.warn('Key validation check failed for TTS key', {
        keyId: key.id,
        provider: key.provider,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await delay(THROTTLE_MS);
    await job.updateProgress(Math.round((ttsChecked / (ttsKeys.length + 1)) * 50));
  }

  // Re-validate all AI BYOK keys
  const aiKeys = await prisma.userAiKey.findMany({
    where: { isValid: true },
    select: { id: true, userId: true, provider: true, encryptedKey: true },
  });

  for (const key of aiKeys) {
    aiChecked++;
    try {
      const apiKey = decryptApiKey(key.encryptedKey);
      const valid = await validateAiProviderCredentials(key.provider as AiProviderId, { apiKey });
      if (!valid) {
        await prisma.userAiKey.update({
          where: { id: key.id },
          data: { isValid: false },
        });
        aiInvalidated++;

        await notifQueue.add('send_notification', {
          userId: key.userId,
          type: 'KEY_INVALID',
          title: 'AI Key Invalid',
          message: `Your ${key.provider} API key is no longer valid. Update it in Settings.`,
          data: {},
        });
      }
    } catch (err) {
      logger.warn('Key validation check failed for AI key', {
        keyId: key.id,
        provider: key.provider,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await delay(THROTTLE_MS);
    await job.updateProgress(50 + Math.round((aiChecked / (aiKeys.length + 1)) * 50));
  }

  logger.info('BYOK key validation completed', {
    ttsChecked,
    ttsInvalidated,
    aiChecked,
    aiInvalidated,
  });
}
