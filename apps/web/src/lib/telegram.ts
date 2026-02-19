import { logger } from './logger';
import type {
  TelegramUpdate,
  TelegramSendMessageOptions,
} from '@/types/telegram';

const TELEGRAM_API_BASE = 'https://api.telegram.org';

function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is not set');
  }
  return token;
}

function apiUrl(method: string): string {
  return `${TELEGRAM_API_BASE}/bot${getBotToken()}/${method}`;
}

async function callApi<T>(method: string, body?: Record<string, unknown>): Promise<T> {
  const url = apiUrl(method);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Telegram API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Telegram API returned ok=false: ${JSON.stringify(data)}`);
  }

  return data.result as T;
}

/**
 * Fetch updates using long polling.
 * timeout=30 means the request blocks for up to 30 seconds waiting for new updates.
 */
export async function getUpdates(
  offset?: number,
  timeout = 30,
  limit = 100
): Promise<TelegramUpdate[]> {
  const body: Record<string, unknown> = {
    timeout,
    limit,
    allowed_updates: ['message', 'callback_query'],
  };
  if (offset !== undefined) {
    body.offset = offset;
  }

  return callApi<TelegramUpdate[]>('getUpdates', body);
}

/**
 * Send a text message to a chat.
 */
export async function sendMessage(
  chatId: string | number,
  text: string,
  options?: TelegramSendMessageOptions
): Promise<{ message_id: number }> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
  };
  if (options?.parse_mode) {
    body.parse_mode = options.parse_mode;
  }
  if (options?.reply_markup) {
    body.reply_markup = options.reply_markup;
  }

  const result = await callApi<{ message_id: number }>('sendMessage', body);
  logger.info('Telegram message sent', { chatId: String(chatId) });
  return result;
}

/**
 * Acknowledge a callback query (dismiss the loading indicator on inline buttons).
 */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
  showAlert?: boolean
): Promise<boolean> {
  const body: Record<string, unknown> = {
    callback_query_id: callbackQueryId,
  };
  if (text) {
    body.text = text;
  }
  if (showAlert) {
    body.show_alert = true;
  }
  return callApi<boolean>('answerCallbackQuery', body);
}

/**
 * Edit the text of an existing message (used to update confirmation messages in-place).
 */
export async function editMessageText(
  chatId: string | number,
  messageId: number,
  text: string,
  options?: TelegramSendMessageOptions
): Promise<void> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text,
  };
  if (options?.parse_mode) {
    body.parse_mode = options.parse_mode;
  }
  if (options?.reply_markup) {
    body.reply_markup = options.reply_markup;
  }
  await callApi<unknown>('editMessageText', body);
}

/**
 * Register a webhook URL with Telegram. Once set, Telegram POSTs updates
 * to this URL instead of holding them for getUpdates polling.
 */
export async function setWebhook(url: string, secretToken: string): Promise<boolean> {
  return callApi<boolean>('setWebhook', {
    url,
    secret_token: secretToken,
    allowed_updates: ['message', 'callback_query'],
  });
}

/**
 * Remove the active webhook so getUpdates polling works again.
 */
export async function deleteWebhook(): Promise<boolean> {
  return callApi<boolean>('deleteWebhook', { drop_pending_updates: false });
}

/**
 * Get current webhook status (useful for debugging).
 */
export async function getWebhookInfo(): Promise<{
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
}> {
  return callApi('getWebhookInfo');
}

export function isTelegramBotConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}
