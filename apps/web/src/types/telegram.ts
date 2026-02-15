import { TelegramMessageStatus } from '@prisma/client';

export interface TelegramParseResult {
  topic: string;
  title: string;
  depth: 'quick_overview' | 'standard' | 'deep_dive';
  audienceLevel: 'beginner' | 'intermediate' | 'expert';
  tone: 'casual' | 'professional' | 'socratic';
  focusAreas: string[];
  sourceUrl?: string;
  isComplete: boolean;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessagePayload;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessagePayload {
  message_id: number;
  from: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessagePayload;
  data?: string;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  first_name?: string;
  username?: string;
}

export interface TelegramInlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
}

export interface TelegramSendMessageOptions {
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  reply_markup?: {
    inline_keyboard: TelegramInlineKeyboardButton[][];
  };
}

export interface TelegramMessageData {
  id: string;
  telegramUserId: string;
  chatId: string;
  text: string | null;
  parsedTopic: string | null;
  status: TelegramMessageStatus;
  podcastId: string | null;
  createdAt: string;
}

export interface TelegramSession {
  userId: string;
  telegramUserId: string;
  chatId: string;
  state: 'discovery' | 'confirming';
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  metadata: {
    topic?: string;
    depth?: string;
    audienceLevel?: string;
    audience?: string;
    focusAreas?: string[];
    tone?: string;
    durationTarget?: number;
    sourceUrl?: string;
  };
}
