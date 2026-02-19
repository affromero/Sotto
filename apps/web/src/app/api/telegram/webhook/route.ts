import { NextRequest, NextResponse } from 'next/server';
import { routeUpdate } from '@/lib/telegram-handler';
import { logger } from '@/lib/logger';
import type { TelegramUpdate } from '@/types/telegram';

/**
 * Telegram webhook handler.
 * Telegram POSTs updates here when a webhook is registered.
 * Always returns 200 to prevent Telegram retry storms.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    logger.error('TELEGRAM_WEBHOOK_SECRET not configured');
    return NextResponse.json({ ok: true });
  }

  // Verify the secret token header set during setWebhook
  const headerSecret = request.headers.get('x-telegram-bot-api-secret-token');
  if (headerSecret !== secret) {
    logger.warn('Telegram webhook: invalid secret token');
    return NextResponse.json({ ok: true });
  }

  try {
    const update = (await request.json()) as TelegramUpdate;
    await routeUpdate(update);
  } catch (err) {
    logger.error('Telegram webhook handler error', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Always return 200 — errors are logged, not retried
  return NextResponse.json({ ok: true });
}
