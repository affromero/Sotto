import { Job } from 'bullmq';
import { randomBytes } from 'crypto';
import {
  PollTelegramUpdatesPayload,
  addJob,
  JobType,
  contentExtractionQueue,
} from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { getRedisClient } from '@/lib/redis';
import { getUpdates, sendMessage, answerCallbackQuery, editMessageText } from '@/lib/telegram';
import { parseTelegramIntent } from '@/lib/telegram-parser';
import { getDiscoveryResponse, parseChips, parseMetadata } from '@/lib/discovery-agent';
import { getAiKey } from '@/lib/byok';
import { canResolveAi } from '@/lib/providers/ai';
import { selectVoicePair } from '@/lib/elevenlabs';
import { logger } from '@/lib/logger';
import type {
  TelegramUpdate,
  TelegramMessagePayload,
  TelegramCallbackQuery,
  TelegramSession,
  TelegramInlineKeyboardButton,
} from '@/types/telegram';

const REDIS_CURSOR_KEY = 'telegram:last_update_id';
const REDIS_SESSION_PREFIX = 'telegram:session:';
const REDIS_LINK_PREFIX = 'telegram:link:';
const SESSION_TTL = 3600; // 1 hour
const LINK_CODE_TTL = 600; // 10 minutes
const SOTTO_APP_URL = process.env.NEXTAUTH_URL || 'https://sotto.fm';

export async function processTelegramUpdates(job: Job<PollTelegramUpdatesPayload>): Promise<void> {
  const redis = getRedisClient();

  const cursorStr = await redis.get(REDIS_CURSOR_KEY);
  const offset = cursorStr ? parseInt(cursorStr, 10) + 1 : undefined;

  const updates = await getUpdates(offset, 30, 100);

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

async function routeUpdate(update: TelegramUpdate): Promise<void> {
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
  if (text === '/cancel') {
    await handleCancel(chatId);
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

  // Check BYOK keys
  const hasAi = await canResolveAi(userId);
  if (!hasAi) {
    await sendMessage(chatId,
      `You need to add an AI API key (Anthropic or OpenAI) in your Sotto settings first.\n\n${SOTTO_APP_URL}/settings`
    );
    return;
  }

  const redis = getRedisClient();
  const sessionKey = `${REDIS_SESSION_PREFIX}${chatId}`;
  const sessionRaw = await redis.get(sessionKey);

  if (sessionRaw) {
    // Continue active discovery session
    const session = JSON.parse(sessionRaw) as TelegramSession;
    await handleDiscoveryMessage(chatId, userId, text, session);
  } else {
    // New message — parse intent
    await handleNewMessage(chatId, userId, telegramUserId, text);
  }
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
      'Your Telegram account is already connected to Sotto! Send me a topic to generate a podcast.'
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

async function handleCancel(chatId: string): Promise<void> {
  const redis = getRedisClient();
  const sessionKey = `${REDIS_SESSION_PREFIX}${chatId}`;
  const deleted = await redis.del(sessionKey);

  if (deleted) {
    await sendMessage(chatId, 'Session cancelled. Send me a new topic whenever you\'re ready.');
  } else {
    await sendMessage(chatId, 'No active session to cancel.');
  }
}

async function handleHelp(chatId: string): Promise<void> {
  await sendMessage(chatId,
    `*Sotto Bot* — Generate AI podcasts from Telegram\n\n` +
    `Just send me a topic and I'll create a 2-voice podcast for you!\n\n` +
    `*Commands:*\n` +
    `/start — Link your Sotto account\n` +
    `/cancel — Cancel the current session\n` +
    `/help — Show this message\n\n` +
    `*Tips:*\n` +
    `• Be specific: "The history of the Silk Road trade routes" works better than "history"\n` +
    `• Include a URL to base the podcast on an article\n` +
    `• If I ask follow-up questions, tap the chip buttons or type your answer`,
    { parse_mode: 'Markdown' }
  );
}

// ─── New Message (Intent Parsing) ───────────────────────────────────────

async function handleNewMessage(
  chatId: string,
  userId: string,
  telegramUserId: string,
  text: string
): Promise<void> {
  const aiKey = await getAiKey(userId);
  const parsed = await parseTelegramIntent(text, aiKey?.apiKey);

  if (parsed.isComplete) {
    await showConfirmation(chatId, userId, telegramUserId, parsed);
  } else {
    await startDiscoverySession(chatId, userId, telegramUserId, text);
  }
}

// ─── Discovery Session ──────────────────────────────────────────────────

async function startDiscoverySession(
  chatId: string,
  userId: string,
  telegramUserId: string,
  initialMessage: string
): Promise<void> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: initialMessage },
  ];

  const aiKey = await getAiKey(userId);
  const response = await getDiscoveryResponse(messages, aiKey?.apiKey);
  const { text: responseText, chips } = parseChips(response.content);
  const metadata = parseMetadata(response.content);

  messages.push({ role: 'assistant', content: response.content });

  const session: TelegramSession = {
    userId,
    telegramUserId,
    chatId,
    state: metadata?.ready ? 'confirming' : 'discovery',
    messages,
    metadata: metadata ? {
      topic: metadata.topic,
      depth: metadata.depth,
      audienceLevel: metadata.audience_level,
      audience: metadata.audience,
      focusAreas: metadata.focus_areas,
      tone: metadata.tone,
      durationTarget: metadata.duration_target,
    } : {},
  };

  const redis = getRedisClient();
  await redis.set(
    `${REDIS_SESSION_PREFIX}${chatId}`,
    JSON.stringify(session),
    'EX',
    SESSION_TTL
  );

  if (metadata?.ready) {
    await showConfirmationFromSession(chatId, session);
  } else {
    await sendMessageWithChips(chatId, responseText, chips);
  }
}

export async function handleDiscoveryMessage(
  chatId: string,
  userId: string,
  userInput: string,
  session: TelegramSession
): Promise<void> {
  session.messages.push({ role: 'user', content: userInput });

  const aiKey = await getAiKey(userId);
  const response = await getDiscoveryResponse(session.messages, aiKey?.apiKey);
  const { text: responseText, chips } = parseChips(response.content);
  const metadata = parseMetadata(response.content);

  session.messages.push({ role: 'assistant', content: response.content });

  if (metadata) {
    session.metadata = {
      topic: metadata.topic,
      depth: metadata.depth,
      audienceLevel: metadata.audience_level,
      audience: metadata.audience,
      focusAreas: metadata.focus_areas,
      tone: metadata.tone,
      durationTarget: metadata.duration_target,
    };
  }

  if (metadata?.ready) {
    session.state = 'confirming';
  }

  const redis = getRedisClient();
  await redis.set(
    `${REDIS_SESSION_PREFIX}${chatId}`,
    JSON.stringify(session),
    'EX',
    SESSION_TTL
  );

  if (metadata?.ready) {
    await showConfirmationFromSession(chatId, session);
  } else {
    await sendMessageWithChips(chatId, responseText, chips);
  }
}

// ─── Confirmation UI ────────────────────────────────────────────────────

async function showConfirmation(
  chatId: string,
  userId: string,
  telegramUserId: string,
  parsed: {
    topic: string;
    title: string;
    depth: string;
    audienceLevel: string;
    tone: string;
    focusAreas: string[];
    sourceUrl?: string;
  }
): Promise<void> {
  const session: TelegramSession = {
    userId,
    telegramUserId,
    chatId,
    state: 'confirming',
    messages: [],
    metadata: {
      topic: parsed.topic,
      depth: parsed.depth,
      audienceLevel: parsed.audienceLevel,
      tone: parsed.tone,
      focusAreas: parsed.focusAreas,
      sourceUrl: parsed.sourceUrl,
    },
  };

  const redis = getRedisClient();
  await redis.set(
    `${REDIS_SESSION_PREFIX}${chatId}`,
    JSON.stringify(session),
    'EX',
    SESSION_TTL
  );

  const text =
    `Ready to generate your podcast!\n\n` +
    `*Topic:* ${parsed.topic}\n` +
    `*Depth:* ${parsed.depth.replace('_', ' ')}\n` +
    `*Audience:* ${parsed.audienceLevel}\n` +
    `*Tone:* ${parsed.tone}`;

  await sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Generate Podcast', callback_data: 'generate' },
          { text: 'Edit Settings', callback_data: 'edit' },
        ],
      ],
    },
  });
}

async function showConfirmationFromSession(chatId: string, session: TelegramSession): Promise<void> {
  const m = session.metadata;
  const text =
    `Ready to generate your podcast!\n\n` +
    `*Topic:* ${m.topic || 'Not set'}\n` +
    `*Depth:* ${(m.depth || 'standard').replace('_', ' ')}\n` +
    `*Audience:* ${m.audienceLevel || 'intermediate'}\n` +
    `*Tone:* ${m.tone || 'casual'}`;

  await sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Generate Podcast', callback_data: 'generate' },
          { text: 'Edit Settings', callback_data: 'edit' },
        ],
      ],
    },
  });
}

// ─── Callback Queries ───────────────────────────────────────────────────

async function handleCallbackQuery(query: TelegramCallbackQuery): Promise<void> {
  const data = query.data;
  const chatId = query.message?.chat ? String(query.message.chat.id) : null;

  if (!data || !chatId) {
    await answerCallbackQuery(query.id);
    return;
  }

  // Chip selection
  if (data.startsWith('chip:')) {
    const chipText = data.substring(5);
    await answerCallbackQuery(query.id);
    await handleChipSelection(chatId, chipText);
    return;
  }

  // Edit setting selection (e.g., edit:depth:deep_dive)
  if (data.startsWith('edit:')) {
    await answerCallbackQuery(query.id);
    await handleEditSelection(chatId, data);
    return;
  }

  switch (data) {
    case 'generate':
      await answerCallbackQuery(query.id, 'Generating...');
      await handleGenerate(chatId, query.message?.message_id);
      break;
    case 'edit':
      await answerCallbackQuery(query.id);
      await handleEditSettings(chatId);
      break;
    case 'back_confirm':
      await answerCallbackQuery(query.id);
      await handleBackToConfirm(chatId);
      break;
    default:
      await answerCallbackQuery(query.id);
  }
}

async function handleChipSelection(chatId: string, chipText: string): Promise<void> {
  const redis = getRedisClient();
  const sessionRaw = await redis.get(`${REDIS_SESSION_PREFIX}${chatId}`);
  if (!sessionRaw) {
    await sendMessage(chatId, 'Session expired. Send me a new topic to start over.');
    return;
  }

  const session = JSON.parse(sessionRaw) as TelegramSession;
  await handleDiscoveryMessage(chatId, session.userId, chipText, session);
}

async function handleGenerate(chatId: string, messageId?: number): Promise<void> {
  const redis = getRedisClient();
  const sessionKey = `${REDIS_SESSION_PREFIX}${chatId}`;
  const sessionRaw = await redis.get(sessionKey);

  if (!sessionRaw) {
    await sendMessage(chatId, 'Session expired. Send me a new topic to start over.');
    return;
  }

  const session = JSON.parse(sessionRaw) as TelegramSession;
  const m = session.metadata;

  if (!m.topic) {
    await sendMessage(chatId, 'Something went wrong — no topic found. Please try again.');
    return;
  }

  // Update the inline message to show "Generating..."
  if (messageId) {
    await editMessageText(chatId, messageId, 'Generating your podcast... This may take a few minutes.').catch(() => {});
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.userId },
    select: { preferredHostVoiceId: true, preferredExpertVoiceId: true },
  });

  // Generate a title from the topic
  const title = m.topic.length > 80 ? m.topic.substring(0, 77) + '...' : m.topic;

  // Voice selection
  const tempId = `tg-${chatId}-${Date.now()}`;
  const voicePair = selectVoicePair(tempId);
  const hostVoiceId = user.preferredHostVoiceId ?? voicePair.host.id;
  const expertVoiceId = user.preferredExpertVoiceId ?? voicePair.expert.id;

  // Create TelegramMessage record
  const telegramMsg = await prisma.telegramMessage.create({
    data: {
      telegramUserId: session.telegramUserId,
      chatId,
      text: m.topic,
      parsedTopic: m.topic,
      status: 'GENERATING',
      userId: session.userId,
    },
  });

  // Create Podcast + Discovery
  const podcast = await prisma.podcast.create({
    data: {
      userId: session.userId,
      title,
      topic: m.topic,
      status: 'EXTRACTING',
      source: 'TELEGRAM',
      hostVoiceId,
      expertVoiceId,
      visibility: 'PUBLIC',
      discovery: {
        create: {
          userId: session.userId,
          topic: m.topic,
          depth: m.depth || 'standard',
          audienceLevel: m.audienceLevel || 'intermediate',
          audience: m.audience,
          tone: m.tone || 'casual',
          focusAreas: m.focusAreas || [],
          durationTarget: m.durationTarget || 10,
          sourceUrl: m.sourceUrl,
        },
      },
    },
    include: { discovery: true },
  });

  // Link TelegramMessage to Podcast
  await prisma.telegramMessage.update({
    where: { id: telegramMsg.id },
    data: { podcastId: podcast.id },
  });

  // Kick off the pipeline
  await addJob(contentExtractionQueue, JobType.EXTRACT_CONTENT, {
    podcastId: podcast.id,
    userId: session.userId,
    sourceUrl: m.sourceUrl,
  });

  // Clear the session
  await redis.del(sessionKey);

  logger.info('Telegram podcast generation started', {
    chatId,
    podcastId: podcast.id,
    topic: m.topic,
  });
}

async function handleEditSettings(chatId: string): Promise<void> {
  const redis = getRedisClient();
  const sessionRaw = await redis.get(`${REDIS_SESSION_PREFIX}${chatId}`);

  if (!sessionRaw) {
    await sendMessage(chatId, 'Session expired. Send me a new topic to start over.');
    return;
  }

  const session = JSON.parse(sessionRaw) as TelegramSession;
  const m = session.metadata;

  const text =
    `Current settings:\n\n` +
    `*Depth:* ${(m.depth || 'standard').replace('_', ' ')}\n` +
    `*Audience:* ${m.audienceLevel || 'intermediate'}\n` +
    `*Tone:* ${m.tone || 'casual'}\n\n` +
    `Tap to change:`;

  const depthButtons: TelegramInlineKeyboardButton[] = [
    { text: 'Quick Overview', callback_data: 'edit:depth:quick_overview' },
    { text: 'Standard', callback_data: 'edit:depth:standard' },
    { text: 'Deep Dive', callback_data: 'edit:depth:deep_dive' },
  ];
  const toneButtons: TelegramInlineKeyboardButton[] = [
    { text: 'Casual', callback_data: 'edit:tone:casual' },
    { text: 'Professional', callback_data: 'edit:tone:professional' },
    { text: 'Socratic', callback_data: 'edit:tone:socratic' },
  ];

  await sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        depthButtons,
        toneButtons,
        [{ text: 'Back to Confirmation', callback_data: 'back_confirm' }],
      ],
    },
  });
}

async function handleBackToConfirm(chatId: string): Promise<void> {
  const redis = getRedisClient();
  const sessionRaw = await redis.get(`${REDIS_SESSION_PREFIX}${chatId}`);

  if (!sessionRaw) {
    await sendMessage(chatId, 'Session expired. Send me a new topic to start over.');
    return;
  }

  const session = JSON.parse(sessionRaw) as TelegramSession;
  await showConfirmationFromSession(chatId, session);
}

async function handleEditSelection(chatId: string, data: string): Promise<void> {
  const redis = getRedisClient();
  const sessionKey = `${REDIS_SESSION_PREFIX}${chatId}`;
  const sessionRaw = await redis.get(sessionKey);

  if (!sessionRaw) {
    await sendMessage(chatId, 'Session expired. Send me a new topic to start over.');
    return;
  }

  const session = JSON.parse(sessionRaw) as TelegramSession;
  // data format: edit:<field>:<value>
  const parts = data.split(':');
  if (parts.length !== 3) return;

  const [, field, value] = parts;
  if (field === 'depth') session.metadata.depth = value;
  if (field === 'tone') session.metadata.tone = value;
  if (field === 'audienceLevel') session.metadata.audienceLevel = value;

  await redis.set(sessionKey, JSON.stringify(session), 'EX', SESSION_TTL);
  await showConfirmationFromSession(chatId, session);
}

// ─── Helpers ────────────────────────────────────────────────────────────

async function sendMessageWithChips(chatId: string, text: string, chips: string[]): Promise<void> {
  if (chips.length === 0) {
    await sendMessage(chatId, text);
    return;
  }

  // Build inline keyboard from chips (max 64 bytes per callback_data)
  const buttons: TelegramInlineKeyboardButton[][] = [];
  const row: TelegramInlineKeyboardButton[] = [];

  for (const chip of chips) {
    const callbackData = `chip:${chip.substring(0, 58)}`; // 5 prefix + 58 content < 64 bytes
    row.push({ text: chip, callback_data: callbackData });
    if (row.length === 2) {
      buttons.push([...row]);
      row.length = 0;
    }
  }
  if (row.length > 0) {
    buttons.push([...row]);
  }

  await sendMessage(chatId, text, {
    reply_markup: { inline_keyboard: buttons },
  });
}
