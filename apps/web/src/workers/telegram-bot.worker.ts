import { Job } from 'bullmq';
import { PollTelegramUpdatesPayload } from '@/lib/queue';
import { getRedisClient } from '@/lib/redis';
import { getUpdates } from '@/lib/telegram';
import { routeUpdate } from '@/lib/telegram-handler';
import { logger } from '@/lib/logger';

const REDIS_CURSOR_KEY = 'telegram:last_update_id';
let webhookConflictLogged = false;

export async function processTelegramUpdates(job: Job<PollTelegramUpdatesPayload>): Promise<void> {
  const redis = getRedisClient();

  const cursorStr = await redis.get(REDIS_CURSOR_KEY);
  const offset = cursorStr ? parseInt(cursorStr, 10) + 1 : undefined;

  const pollTimeout = parseInt(process.env.TELEGRAM_POLL_TIMEOUT || '2', 10);

  let updates: Awaited<ReturnType<typeof getUpdates>>;
  try {
    updates = await getUpdates(offset, pollTimeout, 100);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('409')) {
      if (!webhookConflictLogged) {
        logger.warn('Telegram polling skipped: a webhook is active. Set TELEGRAM_WEBHOOK_URL and TELEGRAM_WEBHOOK_SECRET to use webhook mode.');
        webhookConflictLogged = true;
      }
      return;
    }
    throw err;
  }

  if (updates.length === 0) {
    return;
  }

  for (const update of updates) {
    try {
      await routeUpdate(update);
    } catch (err) {
      logger.error('Error processing Telegram update', {
        updateId: String(update.update_id),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Advance cursor to the highest update_id
  const maxId = updates[updates.length - 1].update_id;
  await redis.set(REDIS_CURSOR_KEY, String(maxId));

  await job.updateProgress(100);
  logger.info('Telegram poll complete', { processed: String(updates.length) });
}
