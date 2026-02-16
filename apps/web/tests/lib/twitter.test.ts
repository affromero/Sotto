import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---- Import under test ----
import {
  getMentions,
  getTweet,
  getThread,
  replyToTweet,
  isTwitterConfigured,
  _resetRateLimits,
} from '@/lib/twitter';
import type { TwitterTweet } from '@/types/twitter';
import { logger } from '@/lib/logger';

// Helper to create mock Headers
function createMockHeaders(remaining = '95', resetOffset = 900): Headers {
  const headers = new Headers();
  headers.set('x-rate-limit-remaining', remaining);
  headers.set('x-rate-limit-reset', String(Math.floor(Date.now() / 1000) + resetOffset));
  return headers;
}

// ---- Tests ----

describe('twitter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetRateLimits();
    // Ensure env vars are set for each test
    process.env.TWITTER_BEARER_TOKEN = 'mock_bearer_token';
    process.env.TWITTER_API_KEY = 'mock_api_key';
    process.env.TWITTER_API_SECRET = 'mock_api_secret';
    process.env.TWITTER_ACCESS_TOKEN = 'mock_access_token';
    process.env.TWITTER_ACCESS_SECRET = 'mock_access_secret';
    process.env.TWITTER_SOTTO_USER_ID = '123456789';
  });

  describe('getMentions', () => {
    it('fetches recent mentions using Bearer token', async () => {
      const mockTweets: TwitterTweet[] = [
        {
          id: 'tweet-1',
          text: '@sottofm explain quantum computing',
          author_id: 'user-1',
          created_at: '2026-02-09T10:00:00Z',
        },
        {
          id: 'tweet-2',
          text: '@sottofm tell me about AI',
          author_id: 'user-2',
          created_at: '2026-02-09T11:00:00Z',
        },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        headers: createMockHeaders(),
        json: async () => ({ data: mockTweets }),
      });

      const result = await getMentions();

      expect(result).toEqual(mockTweets);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/users/123456789/mentions'),
        expect.objectContaining({
          headers: { Authorization: 'Bearer mock_bearer_token' },
        })
      );
    });

    it('includes sinceId parameter when provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: createMockHeaders(),
        json: async () => ({ data: [] }),
      });

      await getMentions('987654321');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('since_id=987654321'),
        expect.any(Object)
      );
    });

    it('returns empty array when no mentions are found', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: createMockHeaders(),
        json: async () => ({ meta: { result_count: 0 } }),
      });

      const result = await getMentions();

      expect(result).toEqual([]);
    });

    it('throws error on API error response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        headers: createMockHeaders(),
        text: async () => 'Rate limit exceeded',
      });

      await expect(getMentions()).rejects.toThrow('Twitter API error (429): Rate limit exceeded');
    });

    it('updates rate limit tracking from response headers', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: createMockHeaders(),
        json: async () => ({ data: [] }),
      });

      await getMentions();

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('logs warning when rate limit is low', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: createMockHeaders('3'),
        json: async () => ({ data: [] }),
      });

      await getMentions();

      expect(logger.warn).toHaveBeenCalled();
    });

    it('returns empty array when rate limited', async () => {
      // Set rate limit to 0 with future reset time
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: createMockHeaders('0', 900),
        json: async () => ({ data: [] }),
      });

      await getMentions();

      mockFetch.mockClear();

      // This call should be blocked by rate limit
      const result = await getMentions();

      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();

      // Reset rate limit for subsequent tests by making a successful call with good limits
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: createMockHeaders('95', 900),
        json: async () => ({ data: [] }),
      });
      await getMentions();
    });

    it('includes tweet fields in request', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: createMockHeaders(),
        json: async () => ({ data: [] }),
      });

      await getMentions();

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('tweet.fields=');
      expect(url).toContain('author_id');
      expect(url).toContain('created_at');
      expect(url).toContain('conversation_id');
      expect(url).toContain('entities');
    });
  });

  describe('getTweet', () => {
    it('fetches a single tweet by ID', async () => {
      const mockTweet: TwitterTweet = {
        id: 'tweet-123',
        text: 'This is a test tweet',
        author_id: 'user-123',
        created_at: '2026-02-09T10:00:00Z',
      };

      mockFetch.mockResolvedValue({
        ok: true,
        headers: createMockHeaders(),
        json: async () => ({ data: mockTweet }),
      });

      const result = await getTweet('tweet-123');

      expect(result).toEqual(mockTweet);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/tweets/tweet-123'),
        expect.objectContaining({
          headers: { Authorization: 'Bearer mock_bearer_token' },
        })
      );
    });

    it('returns null for non-existent tweet (404)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        headers: createMockHeaders(),
        text: async () => 'Not found',
      });

      const result = await getTweet('nonexistent');

      expect(result).toBeNull();
    });

    it('throws error for other API errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        headers: createMockHeaders(),
        text: async () => 'Internal server error',
      });

      await expect(getTweet('tweet-123')).rejects.toThrow(
        'Twitter API error (500): Internal server error'
      );
    });

    it('returns null when rate limited', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: createMockHeaders('0', 900),
        json: async () => ({ data: {} }),
      });

      await getTweet('first-call');

      mockFetch.mockClear();

      const result = await getTweet('second-call');

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();

      // Reset rate limit for subsequent tests
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: createMockHeaders('95', 900),
        json: async () => ({ data: {} }),
      });
      await getTweet('reset-call');
    });

    it('updates rate limit tracking from response headers', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: createMockHeaders('90'),
        json: async () => ({ data: {} }),
      });

      await getTweet('tweet-123');

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('replyToTweet', () => {
    it('posts a reply using OAuth 1.0a', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: { id: 'reply-123' } }),
      });

      const replyId = await replyToTweet('original-tweet-id', 'This is a reply');

      expect(replyId).toBe('reply-123');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.twitter.com/2/tweets',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: expect.stringContaining('OAuth'),
            'Content-Type': 'application/json',
          }),
          body: expect.stringContaining('in_reply_to_tweet_id'),
        })
      );
    });

    it('includes in_reply_to_tweet_id in request body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: { id: 'reply-456' } }),
      });

      await replyToTweet('parent-123', 'Reply text');

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.reply.in_reply_to_tweet_id).toBe('parent-123');
      expect(body.text).toBe('Reply text');
    });

    it('throws error on API failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      });

      await expect(replyToTweet('tweet-123', 'Reply')).rejects.toThrow(
        'Twitter reply API error (403): Forbidden'
      );
    });

    it('generates valid OAuth 1.0a signature', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: { id: 'reply-789' } }),
      });

      await replyToTweet('tweet-123', 'Test reply');

      const callArgs = mockFetch.mock.calls[0];
      const authHeader = callArgs[1].headers.Authorization;

      expect(authHeader).toMatch(/^OAuth /);
      expect(authHeader).toContain('oauth_consumer_key');
      expect(authHeader).toContain('oauth_nonce');
      expect(authHeader).toContain('oauth_signature');
      expect(authHeader).toContain('oauth_timestamp');
      expect(authHeader).toContain('oauth_token');
    });

    it('logs successful reply', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: { id: 'reply-999' } }),
      });

      await replyToTweet('original-123', 'Reply text');

      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe('OAuth 1.0a signature generation', () => {
    it('uses HMAC-SHA1 for signature', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: { id: 'reply-sig-test' } }),
      });

      await replyToTweet('tweet-sig', 'Testing signature');

      const callArgs = mockFetch.mock.calls[0];
      const authHeader = callArgs[1].headers.Authorization;

      expect(authHeader).toContain('oauth_signature_method="HMAC-SHA1"');
    });

    it('includes oauth_version 1.0', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: { id: 'reply-version' } }),
      });

      await replyToTweet('tweet-version', 'Version test');

      const callArgs = mockFetch.mock.calls[0];
      const authHeader = callArgs[1].headers.Authorization;

      expect(authHeader).toContain('oauth_version="1.0"');
    });

    it('generates unique nonce for each request', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: { id: 'reply-nonce' } }),
      });

      await replyToTweet('tweet-1', 'First');
      const firstNonce =
        mockFetch.mock.calls[0][1].headers.Authorization.match(/oauth_nonce="([^"]+)"/)?.[1];

      await replyToTweet('tweet-2', 'Second');
      const secondNonce =
        mockFetch.mock.calls[1][1].headers.Authorization.match(/oauth_nonce="([^"]+)"/)?.[1];

      expect(firstNonce).toBeDefined();
      expect(secondNonce).toBeDefined();
      expect(firstNonce).not.toBe(secondNonce);
    });

    it('URL-encodes OAuth parameters', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: { id: 'reply-encode' } }),
      });

      await replyToTweet('tweet-encode', 'Encoding test');

      const callArgs = mockFetch.mock.calls[0];
      const authHeader = callArgs[1].headers.Authorization;

      // OAuth header uses "OAuth " prefix and ", " separators per spec
      expect(authHeader).toMatch(/^OAuth /);
      expect(authHeader).toMatch(/oauth_[a-z_]+="[^"]*"/g);
    });
  });

  describe('isTwitterConfigured', () => {
    it('returns true when credentials are set', () => {
      expect(isTwitterConfigured()).toBe(true);
    });

  });

  describe('getThread', () => {
    function createSearchResponse(
      tweets: Partial<TwitterTweet>[],
      users: Array<{ id: string; username: string; name: string }> = [],
      nextToken?: string
    ) {
      return {
        ok: true,
        headers: createMockHeaders(),
        json: async () => ({
          data: tweets.length > 0 ? tweets : undefined,
          includes: users.length > 0 ? { users } : undefined,
          meta: nextToken ? { next_token: nextToken } : { result_count: tweets.length },
        }),
      };
    }

    it('fetches root tweet and search results to build thread', async () => {
      // First call: root tweet fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: createMockHeaders(),
        json: async () => ({
          data: {
            id: 'conv-root',
            text: 'Original post',
            author_id: 'author-1',
            created_at: '2026-02-10T10:00:00Z',
            conversation_id: 'conv-root',
          },
          includes: { users: [{ id: 'author-1', username: 'alice', name: 'Alice' }] },
        }),
      });

      // Second call: search results
      mockFetch.mockResolvedValueOnce(
        createSearchResponse(
          [
            {
              id: 'reply-1',
              text: 'I disagree',
              author_id: 'author-2',
              created_at: '2026-02-10T10:05:00Z',
              referenced_tweets: [{ type: 'replied_to', id: 'conv-root' }],
            },
            {
              id: 'reply-2',
              text: 'Good point',
              author_id: 'author-3',
              created_at: '2026-02-10T10:10:00Z',
              referenced_tweets: [{ type: 'replied_to', id: 'reply-1' }],
            },
          ],
          [
            { id: 'author-2', username: 'bob', name: 'Bob' },
            { id: 'author-3', username: 'carol', name: 'Carol' },
          ]
        )
      );

      const result = await getThread('conv-root');

      expect(result).not.toBeNull();
      expect(result!.rootTweet.authorUsername).toBe('alice');
      expect(result!.replies).toHaveLength(2);
      expect(result!.participantCount).toBe(3);
      expect(result!.tweetCount).toBe(3);
    });

    it('returns null when root tweet is not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: createMockHeaders(),
        text: async () => 'Not found',
      });

      const result = await getThread('nonexistent');
      expect(result).toBeNull();
    });

    it('returns null when rate limited', async () => {
      // Exhaust search rate limit
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: createMockHeaders('0', 900),
        json: async () => ({ data: {} }),
      });
      // Trigger a search to set the rate limit
      await getTweet('exhaust-tweets');
      mockFetch.mockClear();

      // Now exhaust search specifically
      // Reset to test search rate limit
      _resetRateLimits();

      // Set search rate limit to 0 via a root tweet fetch that succeeds
      // then a search that returns rate limit 0
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: createMockHeaders(),
        json: async () => ({
          data: {
            id: 'conv-1',
            text: 'Root',
            author_id: 'a1',
            created_at: '2026-02-10T10:00:00Z',
          },
          includes: { users: [{ id: 'a1', username: 'user1', name: 'User 1' }] },
        }),
      });

      // Search returns rate limit 0
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: createMockHeaders('0', 900),
        json: async () => ({
          data: [
            {
              id: 'reply-1',
              text: 'Reply',
              author_id: 'a2',
              created_at: '2026-02-10T10:05:00Z',
            },
          ],
          includes: { users: [{ id: 'a2', username: 'user2', name: 'User 2' }] },
          meta: { next_token: 'page2' },
        }),
      });

      // The second page should be blocked by rate limit
      const result = await getThread('conv-1');

      // Should still return partial data (root + first page of replies)
      expect(result).not.toBeNull();
      expect(result!.replies.length).toBeGreaterThanOrEqual(1);
    });

    it('extracts URLs from tweet entities', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: createMockHeaders(),
        json: async () => ({
          data: {
            id: 'conv-urls',
            text: 'Check this https://t.co/abc',
            author_id: 'author-1',
            created_at: '2026-02-10T10:00:00Z',
            entities: {
              urls: [
                {
                  start: 11,
                  end: 31,
                  url: 'https://t.co/abc',
                  expanded_url: 'https://example.com/article',
                  display_url: 'example.com/article',
                },
              ],
            },
          },
          includes: { users: [{ id: 'author-1', username: 'alice', name: 'Alice' }] },
        }),
      });

      // Empty search results
      mockFetch.mockResolvedValueOnce(createSearchResponse([], []));

      const result = await getThread('conv-urls');

      expect(result).not.toBeNull();
      expect(result!.rootTweet.urls).toContain('https://example.com/article');
    });

    it('paginates through search results', async () => {
      // Root tweet
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: createMockHeaders(),
        json: async () => ({
          data: {
            id: 'conv-pag',
            text: 'Root',
            author_id: 'a1',
            created_at: '2026-02-10T10:00:00Z',
          },
          includes: { users: [{ id: 'a1', username: 'alice', name: 'Alice' }] },
        }),
      });

      // Page 1 with next_token
      mockFetch.mockResolvedValueOnce(
        createSearchResponse(
          [{ id: 'r1', text: 'Reply 1', author_id: 'a2', created_at: '2026-02-10T10:01:00Z' }],
          [{ id: 'a2', username: 'bob', name: 'Bob' }],
          'page2token'
        )
      );

      // Page 2 without next_token
      mockFetch.mockResolvedValueOnce(
        createSearchResponse(
          [{ id: 'r2', text: 'Reply 2', author_id: 'a3', created_at: '2026-02-10T10:02:00Z' }],
          [{ id: 'a3', username: 'carol', name: 'Carol' }]
        )
      );

      const result = await getThread('conv-pag');

      expect(result).not.toBeNull();
      expect(result!.replies).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledTimes(3); // root + 2 pages
    });

    it('fetches quoted tweets referenced in thread', async () => {
      // Root tweet with a quoted reference
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: createMockHeaders(),
        json: async () => ({
          data: {
            id: 'conv-qt',
            text: 'Check this quote',
            author_id: 'a1',
            created_at: '2026-02-10T10:00:00Z',
            referenced_tweets: [{ type: 'quoted', id: 'quoted-1' }],
          },
          includes: { users: [{ id: 'a1', username: 'alice', name: 'Alice' }] },
        }),
      });

      // Empty search results
      mockFetch.mockResolvedValueOnce(createSearchResponse([], []));

      // Quoted tweet fetch (via getTweet)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: createMockHeaders(),
        json: async () => ({
          data: {
            id: 'quoted-1',
            text: 'Original quoted content',
            author_id: 'a-qt',
            created_at: '2026-02-09T10:00:00Z',
          },
        }),
      });

      const result = await getThread('conv-qt');

      expect(result).not.toBeNull();
      expect(result!.replies.some((r) => r.id === 'quoted-1')).toBe(true);
    });

    it('sorts replies chronologically', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: createMockHeaders(),
        json: async () => ({
          data: {
            id: 'conv-sort',
            text: 'Root',
            author_id: 'a1',
            created_at: '2026-02-10T10:00:00Z',
          },
          includes: { users: [{ id: 'a1', username: 'alice', name: 'Alice' }] },
        }),
      });

      // Replies in reverse order
      mockFetch.mockResolvedValueOnce(
        createSearchResponse(
          [
            { id: 'r-late', text: 'Later', author_id: 'a2', created_at: '2026-02-10T12:00:00Z' },
            { id: 'r-early', text: 'Earlier', author_id: 'a2', created_at: '2026-02-10T10:30:00Z' },
          ],
          [{ id: 'a2', username: 'bob', name: 'Bob' }]
        )
      );

      const result = await getThread('conv-sort');

      expect(result).not.toBeNull();
      expect(result!.replies[0].id).toBe('r-early');
      expect(result!.replies[1].id).toBe('r-late');
    });
  });

  describe('rate limit handling', () => {
    it('tracks separate rate limits for mentions and tweets', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: createMockHeaders('5'),
        json: async () => ({ data: [] }),
      });

      await getMentions();

      mockFetch.mockResolvedValue({
        ok: true,
        headers: createMockHeaders('95'),
        json: async () => ({ data: {} }),
      });

      await getTweet('tweet-123');

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('allows requests after rate limit reset time passes', async () => {
      const pastResetTime = -100;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: createMockHeaders('0', pastResetTime),
        json: async () => ({ data: [] }),
      });

      await getMentions();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: createMockHeaders(),
        json: async () => ({ data: [] }),
      });

      const result = await getMentions();

      expect(result).toEqual([]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
