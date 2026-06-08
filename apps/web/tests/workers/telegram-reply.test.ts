import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import type { ReplyTelegramPayload } from '@/lib/queue';

const mockPrismaPodcastFindUniqueOrThrow = vi.fn();
const mockPrismaTelegramMessageUpdate = vi.fn();

vi.mock('@/lib/prisma', () => {
  const prisma = {
    podcast: {
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaPodcastFindUniqueOrThrow(...args),
    },
    telegramMessage: {
      update: (...args: unknown[]) => mockPrismaTelegramMessageUpdate(...args),
    },
  };
  return { prisma, prismaUnfiltered: prisma };
});

const mockSendMessage = vi.fn();

vi.mock('@/lib/telegram', () => ({
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { processTelegramReply } from '@/workers/telegram-reply.worker';

function createMockJob(data: ReplyTelegramPayload): Job<ReplyTelegramPayload> {
  return {
    data,
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<ReplyTelegramPayload>;
}

describe('processTelegramReply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://selfhost.example.com');
    mockSendMessage.mockResolvedValue(undefined);
    mockPrismaTelegramMessageUpdate.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sends a listen button with the configured deployment URL', async () => {
    mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
      title: 'Daily Private Briefing',
      duration: 600,
      status: 'READY',
      slug: 'daily-private-briefing',
      user: { handle: 'alice' },
    });

    await processTelegramReply(
      createMockJob({
        podcastId: 'pod-1',
        telegramMessageId: 'telegram-message-1',
        chatId: 'chat-1',
      })
    );

    expect(mockSendMessage).toHaveBeenCalledWith(
      'chat-1',
      expect.stringContaining('Daily Private Briefing'),
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Listen Now',
                url: 'https://selfhost.example.com/@alice/daily-private-briefing',
              },
            ],
          ],
        },
      }
    );
    expect(mockSendMessage.mock.calls[0][2].reply_markup.inline_keyboard[0][0].url).not.toContain(
      'https://sotto.fm'
    );
  });

  it('uses the configured deployment URL in failure messages', async () => {
    mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
      title: 'Failed Briefing',
      duration: null,
      status: 'FAILED',
      slug: null,
      user: { handle: null },
    });

    await processTelegramReply(
      createMockJob({
        podcastId: 'pod-2',
        telegramMessageId: 'telegram-message-2',
        chatId: 'chat-2',
      })
    );

    expect(mockSendMessage).toHaveBeenCalledWith(
      'chat-2',
      expect.stringContaining('https://selfhost.example.com')
    );
    expect(mockSendMessage.mock.calls[0][1]).not.toContain('https://sotto.fm');
  });
});
