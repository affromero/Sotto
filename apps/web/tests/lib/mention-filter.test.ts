import { beforeEach, describe, expect, it, vi } from 'vitest';
import { filterMention } from '@/lib/mention-filter';
import type { TwitterAuthorData, TwitterTweet } from '@/types/twitter';

const mockRedisGet = vi.fn();
const mockRedisIncr = vi.fn();
const mockRedisExpire = vi.fn();
const mockRedisExec = vi.fn();
const mockGenerateResponse = vi.fn();
const mockCreateAIProvider = vi.fn((_type?: string) => ({
  generateResponse: mockGenerateResponse,
}));
const mockLogUsage = vi.fn();

vi.mock('@/lib/redis', () => ({
  getRedisClient: () => ({
    get: (key: string) => mockRedisGet(key),
    multi: () => ({
      incr: (key: string) => mockRedisIncr(key),
      expire: (key: string, ttl: number) => mockRedisExpire(key, ttl),
      exec: () => mockRedisExec(),
    }),
  }),
}));

vi.mock('@/lib/prompt-loader', () => ({
  loadPrompt: vi.fn().mockReturnValue('Classify mention intent.'),
}));

vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: (type?: string) => mockCreateAIProvider(type),
}));

vi.mock('@/lib/usage-logger', () => ({
  logUsage: (entry: unknown) => mockLogUsage(entry),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function tweet(overrides: Partial<TwitterTweet> = {}): TwitterTweet {
  return {
    id: 'tweet-1',
    text: '@sottofm make this a private podcast about AI',
    author_id: 'author-1',
    created_at: '2026-05-01T00:00:00Z',
    ...overrides,
  } as TwitterTweet;
}

function author(overrides: Partial<TwitterAuthorData> = {}): TwitterAuthorData {
  return {
    id: 'author-1',
    username: 'alice',
    name: 'Alice',
    createdAt: '2020-01-01T00:00:00Z',
    publicMetrics: {
      followers_count: 10,
      following_count: 5,
      tweet_count: 100,
      listed_count: 0,
    },
    ...overrides,
  } as TwitterAuthorData;
}

describe('filterMention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisExec.mockResolvedValue([]);
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        classification: 'genuine',
        confidence: 0.99,
        reason: 'Genuine request',
      }),
      model: 'gpt-5-nano',
      inputTokens: 12,
      outputTokens: 4,
    });
  });

  it('passes structural mentions without an AI runtime and does not select a provider', async () => {
    const result = await filterMention(tweet(), author(), false, false, { ai: null });

    expect(result).toEqual({ verdict: 'pass', reason: 'Passed all filters' });
    expect(mockCreateAIProvider).not.toHaveBeenCalled();
    expect(mockRedisIncr).toHaveBeenCalledWith('twitter:mention_rate:author-1');
  });

  it('uses the explicit AI runtime when provided', async () => {
    const result = await filterMention(tweet(), author(), true, false, {
      ai: {
        providerType: 'openai',
        model: 'gpt-5-nano',
        apiKeyOverride: 'openai-key',
      },
    });

    expect(result).toEqual({ verdict: 'pass', reason: 'Passed all filters' });
    expect(mockCreateAIProvider).toHaveBeenCalledWith('openai');
    expect(mockGenerateResponse).toHaveBeenCalledWith(
      'Classify mention intent.',
      [expect.objectContaining({ role: 'user' })],
      {
        maxTokens: 128,
        model: 'gpt-5-nano',
        apiKeyOverride: 'openai-key',
      }
    );
    expect(mockLogUsage).toHaveBeenCalledWith({
      service: 'openai',
      model: 'gpt-5-nano',
      category: 'mention_filter',
      inputTokens: 12,
      outputTokens: 4,
    });
  });

  it('blocks high-confidence spam from the explicit classifier', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        classification: 'spam',
        confidence: 0.95,
        reason: 'Promotional spam',
      }),
      model: 'gpt-5-nano',
      inputTokens: 12,
      outputTokens: 4,
    });

    const result = await filterMention(tweet(), author(), false, false, {
      ai: {
        providerType: 'openai',
        model: 'gpt-5-nano',
      },
    });

    expect(result).toEqual({ verdict: 'skip_spam', reason: 'Promotional spam' });
    expect(mockRedisIncr).not.toHaveBeenCalled();
  });

  it('fails closed when explicit AI runtime is malformed', async () => {
    const result = await filterMention(tweet(), author(), false, false, {
      ai: {
        providerType: 'openai',
        model: '',
      },
    });

    expect(result).toEqual({ verdict: 'skip_spam', reason: 'Filter error — blocking by default' });
    expect(mockRedisIncr).not.toHaveBeenCalled();
  });
});
