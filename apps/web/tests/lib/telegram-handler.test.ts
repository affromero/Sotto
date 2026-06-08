import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TelegramSendMessageOptions, TelegramUpdate } from '@/types/telegram';

const mockRedisSet = vi.fn();

vi.mock('@/lib/redis', () => ({
  getRedisClient: vi.fn(() => ({
    set: (...args: unknown[]) => mockRedisSet(...args),
  })),
}));

const mockPrismaAccountFindFirst = vi.fn();
const mockPrismaUserFindUniqueOrThrow = vi.fn();
const mockPrismaPodcastIdeaCreate = vi.fn();

vi.mock('@/lib/prisma', () => {
  const prisma = {
    account: {
      findFirst: (...args: unknown[]) => mockPrismaAccountFindFirst(...args),
    },
    user: {
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaUserFindUniqueOrThrow(...args),
    },
    podcastIdea: {
      create: (...args: unknown[]) => mockPrismaPodcastIdeaCreate(...args),
    },
  };
  return { prisma, prismaUnfiltered: prisma };
});

const mockSendMessage = vi.fn();
const mockAnswerCallbackQuery = vi.fn();

vi.mock('@/lib/telegram', () => ({
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
  answerCallbackQuery: (...args: unknown[]) => mockAnswerCallbackQuery(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { routeUpdate } from '@/lib/telegram-handler';

function createTextUpdate(text: string): TelegramUpdate {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      from: {
        id: 123,
        is_bot: false,
        first_name: 'Alice',
      },
      chat: {
        id: 456,
        type: 'private',
      },
      date: 1_766_000_000,
      text,
    },
  };
}

function getInlineButtonUrl(callIndex: number): string {
  const options = mockSendMessage.mock.calls[callIndex][2] as TelegramSendMessageOptions;
  return options.reply_markup?.inline_keyboard[0]?.[0]?.url ?? '';
}

describe('telegram update routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://selfhost.example.com');
    mockRedisSet.mockResolvedValue('OK');
    mockSendMessage.mockResolvedValue(undefined);
    mockPrismaPodcastIdeaCreate.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the configured deployment URL for account linking', async () => {
    mockPrismaAccountFindFirst.mockResolvedValue(null);

    await routeUpdate(createTextUpdate('/start'));

    expect(getInlineButtonUrl(0)).toMatch(
      /^https:\/\/selfhost\.example\.com\/connect\/telegram\?code=[a-f0-9]{32}$/
    );
    expect(getInlineButtonUrl(0)).not.toContain('https://sotto.fm');
  });

  it('uses the configured deployment URL after saving an idea', async () => {
    mockPrismaAccountFindFirst.mockResolvedValue({ userId: 'user-1' });
    mockPrismaUserFindUniqueOrThrow.mockResolvedValue({ telegramEnabled: true });

    await routeUpdate(createTextUpdate('news briefing about private AI agents'));

    expect(mockPrismaPodcastIdeaCreate).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        text: 'news briefing about private AI agents',
        sourceUrl: undefined,
        source: 'telegram',
      },
    });
    expect(getInlineButtonUrl(0)).toBe('https://selfhost.example.com/ideas');
  });
});
