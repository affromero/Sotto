import { randomBytes } from 'crypto';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { getRedisClient } from '@/lib/redis';
import { sendMessage, answerCallbackQuery } from '@/lib/telegram';
import { logger } from '@/lib/logger';
import type {
  TelegramUpdate,
  TelegramMessagePayload,
  TelegramCallbackQuery,
} from '@/types/telegram';

const REDIS_LINK_PREFIX = 'telegram:link:';
const LINK_CODE_TTL = 600; // 10 minutes
const SOTTO_APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://sotto.fm';

export async function routeUpdate(update: TelegramUpdate): Promise<void> {
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return;
  }

  if (update.message?.text) {
    await handleTextMessage(update.message);
  }
}

// ─── Text Message Routing ───────────────────────────────────────────────

async function handleTextMessage(msg: TelegramMessagePayload): Promise<void> {
  const text = msg.text!.trim();
  const chatId = String(msg.chat.id);
  const telegramUserId = String(msg.from.id);

  // Commands
  if (text.startsWith('/start')) {
    await handleStart(msg);
    return;
  }
  if (text === '/help') {
    await handleHelp(chatId);
    return;
  }

  // Require a linked Sotto account
  const account = await prisma.account.findFirst({
    where: { provider: 'telegram', providerAccountId: telegramUserId },
    select: { userId: true },
  });

  if (!account) {
    await sendMessage(chatId,
      'You need to link your Sotto account first. Send /start to get a connection link.'
    );
    return;
  }

  const userId = account.userId;

  // Check Telegram integration is enabled
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { telegramEnabled: true },
  });

  if (!user.telegramEnabled) {
    await sendMessage(chatId, 'Telegram integration is disabled for your account. Enable it in your Sotto settings.');
    return;
  }

  await handleSaveIdea(chatId, userId, text);
}

// ─── Commands ───────────────────────────────────────────────────────────

async function handleStart(msg: TelegramMessagePayload): Promise<void> {
  const chatId = String(msg.chat.id);
  const telegramUserId = String(msg.from.id);
  const firstName = msg.from.first_name;

  // Check if already linked
  const existing = await prisma.account.findFirst({
    where: { provider: 'telegram', providerAccountId: telegramUserId },
  });

  if (existing) {
    await sendMessage(chatId,
      'Your Telegram account is already connected!\nSend me any topic or URL — including YouTube and video links — to save it as a podcast idea.'
    );
    return;
  }

  // Generate link code and store in Redis
  const code = randomBytes(16).toString('hex');
  const redis = getRedisClient();
  await redis.set(
    `${REDIS_LINK_PREFIX}${code}`,
    JSON.stringify({ telegramUserId, chatId, firstName }),
    'EX',
    LINK_CODE_TTL
  );

  const linkUrl = `${SOTTO_APP_URL}/connect/telegram?code=${code}`;

  await sendMessage(chatId,
    `Welcome to Sotto! Let's link your Telegram account.\n\nTap the button below to connect:`,
    {
      reply_markup: {
        inline_keyboard: [[{ text: 'Connect to Sotto', url: linkUrl }]],
      },
    }
  );
}

async function handleHelp(chatId: string): Promise<void> {
  await sendMessage(chatId,
    `*Sotto Bot* — Your podcast companion\n\n` +
    `Send me any topic or URL — including YouTube and video links — and I'll save it as a podcast idea.\n` +
    `Open Sotto to generate your podcast whenever you're ready!\n\n` +
    `*Commands:*\n` +
    `/start — Link your Sotto account\n` +
    `/help — Show this message\n\n` +
    `*Notifications:*\n` +
    `I'll send you a message when your podcasts are ready.`,
    { parse_mode: 'Markdown' }
  );
}

// ─── Save Idea ──────────────────────────────────────────────────────────

async function handleSaveIdea(chatId: string, userId: string, text: string): Promise<void> {
  const isUrl = text.startsWith('http://') || text.startsWith('https://');
  const sourceUrl = isUrl ? text : undefined;
  const ideaText = isUrl ? `Podcast from: ${text}` : text;

  await prisma.podcastIdea.create({
    data: { userId, text: ideaText, sourceUrl, source: 'telegram' },
  });

  logger.info('Telegram podcast idea saved', { chatId, userId, isUrl });

  await sendMessage(chatId,
    'Saved! Open Sotto to create your podcast.',
    {
      reply_markup: {
        inline_keyboard: [[{ text: 'Open Sotto', url: `${SOTTO_APP_URL}/ideas` }]],
      },
    }
  );
}

// ─── Callback Queries ───────────────────────────────────────────────────

async function handleCallbackQuery(query: TelegramCallbackQuery): Promise<void> {
  await answerCallbackQuery(
    query.id,
    'This button is no longer active. Send me a topic to save it as a podcast idea.',
    true
  );
}
