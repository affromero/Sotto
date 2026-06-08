import { afterEach, describe, expect, it } from 'vitest';
import {
  getTelegramBotLabel,
  getTelegramBotUsername,
  getTwitterBotHandle,
  getTwitterBotLabel,
  getTwitterProfileUrl,
  normalizeBotHandle,
  stripTwitterBotMentions,
} from '@/lib/bot-identity';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('bot identity helpers', () => {
  it('normalizes bot handles from handles and profile URLs', () => {
    expect(normalizeBotHandle('briefbot')).toBe('@briefbot');
    expect(normalizeBotHandle('@briefbot')).toBe('@briefbot');
    expect(normalizeBotHandle('https://x.com/briefbot')).toBe('@briefbot');
    expect(normalizeBotHandle('https://twitter.com/briefbot/status/123')).toBe('@briefbot');
    expect(normalizeBotHandle('')).toBeNull();
  });

  it('reads public bot labels without Sotto-specific defaults', () => {
    process.env.NEXT_PUBLIC_TWITTER_BOT_HANDLE = '@briefbot';
    process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME = 'BriefingBot';

    expect(getTwitterBotHandle()).toBe('@briefbot');
    expect(getTelegramBotUsername()).toBe('@BriefingBot');
    expect(getTwitterBotLabel()).toBe('@briefbot');
    expect(getTelegramBotLabel()).toBe('@BriefingBot');
    expect(getTwitterProfileUrl(getTwitterBotHandle())).toBe('https://x.com/briefbot');
  });

  it('uses generic labels when optional bot display handles are unset', () => {
    delete process.env.NEXT_PUBLIC_TWITTER_BOT_HANDLE;
    delete process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;

    expect(getTwitterBotLabel()).toBe('your configured Twitter bot');
    expect(getTelegramBotLabel()).toBe('your Telegram bot');
    expect(getTwitterProfileUrl(getTwitterBotHandle())).toBeNull();
  });

  it('strips the configured bot handle from mentions', () => {
    process.env.NEXT_PUBLIC_TWITTER_BOT_HANDLE = '@briefbot';

    expect(stripTwitterBotMentions('@briefbot explain quantum physics')).toBe(
      'explain quantum physics'
    );
    expect(stripTwitterBotMentions('@someone_else explain quantum physics')).toBe(
      '@someone_else explain quantum physics'
    );
  });

  it('strips all handles only when no bot handle is configured', () => {
    delete process.env.NEXT_PUBLIC_TWITTER_BOT_HANDLE;

    expect(stripTwitterBotMentions('@briefbot @alice explain quantum physics')).toBe(
      'explain quantum physics'
    );
  });
});
