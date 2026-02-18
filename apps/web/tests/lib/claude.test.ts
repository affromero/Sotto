import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- Mocks ----

const mockMessagesCreate = vi.fn();
const mockMessagesStream = vi.fn();

class MockAnthropic {
  messages = {
    create: mockMessagesCreate,
    stream: mockMessagesStream,
  };
}

vi.mock('@anthropic-ai/sdk', () => ({
  default: MockAnthropic,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockApiUsageLogCreate = vi.fn().mockResolvedValue({});

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    apiUsageLog: {
      create: (...args: unknown[]) => mockApiUsageLogCreate(...args),
    },
  };
  return { prisma: _mockPrisma };
});

// Prevent claude-code-client from spawning a real CLI process
// (e.g. when AI_PROVIDER=claude-code leaks from .env into tests)
vi.mock('@/lib/claude-code-client', () => ({
  executeClaudeCode: vi.fn().mockResolvedValue({ content: '', inputTokens: 0, outputTokens: 0 }),
  serializeMessages: vi.fn().mockReturnValue(''),
  streamClaudeCode: vi.fn(),
}));

// ---- Tests ----

describe('claude', () => {
  let originalApiKey: string | undefined;
  let originalAiProvider: string | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    originalApiKey = process.env.ANTHROPIC_API_KEY;
    originalAiProvider = process.env.AI_PROVIDER;
    // Set API key and force Anthropic SDK path (not claude-code)
    process.env.ANTHROPIC_API_KEY = 'test-api-key-123';
    process.env.AI_PROVIDER = 'anthropic';
    // Clear module cache to force re-import
    vi.resetModules();
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = originalApiKey;
    if (originalAiProvider !== undefined) {
      process.env.AI_PROVIDER = originalAiProvider;
    } else {
      delete process.env.AI_PROVIDER;
    }
  });

  describe('generateResponse', () => {
    it('generates a non-streaming response with default options', async () => {
      const { generateResponse } = await import('@/lib/claude');

      const mockResponse = {
        content: [
          {
            type: 'text' as const,
            text: 'This is a test response from Claude.',
          },
        ],
        usage: {
          input_tokens: 150,
          output_tokens: 75,
        },
      };

      mockMessagesCreate.mockResolvedValue(mockResponse);

      const result = await generateResponse('You are a helpful assistant.', [
        { role: 'user', content: 'Hello, Claude!' },
      ]);

      expect(result).toEqual({
        content: 'This is a test response from Claude.',
        inputTokens: 150,
        outputTokens: 75,
      });
    });

    it('returns empty content when response has no text block', async () => {
      const { generateResponse } = await import('@/lib/claude');

      const mockResponse = {
        content: [
          {
            type: 'tool_use' as const,
            id: 'tool-123',
            name: 'get_weather',
            input: {},
          },
        ],
        usage: {
          input_tokens: 50,
          output_tokens: 10,
        },
      };

      mockMessagesCreate.mockResolvedValue(mockResponse);

      const result = await generateResponse('You are a helpful assistant.', [
        { role: 'user', content: 'Check weather' },
      ]);

      expect(result.content).toBe('');
      expect(result.inputTokens).toBe(50);
      expect(result.outputTokens).toBe(10);
    });

    it('extracts text from first text block when multiple blocks exist', async () => {
      const { generateResponse } = await import('@/lib/claude');

      const mockResponse = {
        content: [
          {
            type: 'text' as const,
            text: 'First text block',
          },
          {
            type: 'text' as const,
            text: 'Second text block',
          },
        ],
        usage: {
          input_tokens: 100,
          output_tokens: 40,
        },
      };

      mockMessagesCreate.mockResolvedValue(mockResponse);

      const result = await generateResponse('You are a helpful assistant.', [
        { role: 'user', content: 'Test' },
      ]);

      expect(result.content).toBe('First text block\n\nSecond text block');
    });

    it('throws error when API key is not set', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      vi.resetModules();

      const { generateResponse } = await import('@/lib/claude');

      await expect(
        generateResponse('System prompt', [{ role: 'user', content: 'Test' }])
      ).rejects.toThrow('Claude client not initialized — set ANTHROPIC_API_KEY');
    });

    it('propagates API errors from Anthropic SDK', async () => {
      const { generateResponse } = await import('@/lib/claude');

      const apiError = new Error('Rate limit exceeded');
      mockMessagesCreate.mockRejectedValue(apiError);

      await expect(
        generateResponse('System prompt', [{ role: 'user', content: 'Test' }])
      ).rejects.toThrow('Rate limit exceeded');
    });

    it('handles authentication errors gracefully', async () => {
      const { generateResponse } = await import('@/lib/claude');

      const authError = new Error('Invalid API key');
      mockMessagesCreate.mockRejectedValue(authError);

      await expect(
        generateResponse('System prompt', [{ role: 'user', content: 'Test' }])
      ).rejects.toThrow('Invalid API key');
    });

    it('handles network timeout errors', async () => {
      const { generateResponse } = await import('@/lib/claude');

      const timeoutError = new Error('Request timeout');
      mockMessagesCreate.mockRejectedValue(timeoutError);

      await expect(
        generateResponse('System prompt', [{ role: 'user', content: 'Test' }])
      ).rejects.toThrow('Request timeout');
    });

    it('passes tools to messages.create when provided', async () => {
      const { generateResponse, WEB_SEARCH_TOOL } = await import('@/lib/claude');

      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text' as const, text: 'Response with tools' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      await generateResponse('System prompt', [{ role: 'user', content: 'Test' }], {
        tools: [WEB_SEARCH_TOOL],
      });

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        })
      );
    });

    it('does not pass tools when undefined', async () => {
      const { generateResponse } = await import('@/lib/claude');

      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text' as const, text: 'No tools' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      await generateResponse('System prompt', [{ role: 'user', content: 'Test' }]);

      const callArg = mockMessagesCreate.mock.calls[0][0];
      expect(callArg).not.toHaveProperty('tools');
    });
  });

  describe('streamResponse', () => {
    it('streams text deltas from Claude', async () => {
      const { streamResponse } = await import('@/lib/claude');

      const mockEvents = [
        {
          type: 'content_block_delta' as const,
          delta: {
            type: 'text_delta' as const,
            text: 'Hello ',
          },
        },
        {
          type: 'content_block_delta' as const,
          delta: {
            type: 'text_delta' as const,
            text: 'from ',
          },
        },
        {
          type: 'content_block_delta' as const,
          delta: {
            type: 'text_delta' as const,
            text: 'Claude!',
          },
        },
      ];

      async function* mockGenerator() {
        for (const event of mockEvents) {
          yield event;
        }
      }

      mockMessagesStream.mockReturnValue(mockGenerator());

      const chunks: string[] = [];
      for await (const chunk of streamResponse('System prompt', [
        { role: 'user', content: 'Stream test' },
      ])) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hello ', 'from ', 'Claude!']);
    });

    it('ignores non-text-delta events', async () => {
      const { streamResponse } = await import('@/lib/claude');

      const mockEvents = [
        {
          type: 'message_start' as const,
          message: {
            id: 'msg-123',
            role: 'assistant',
          },
        },
        {
          type: 'content_block_delta' as const,
          delta: {
            type: 'text_delta' as const,
            text: 'Visible text',
          },
        },
        {
          type: 'content_block_stop' as const,
          index: 0,
        },
      ];

      async function* mockGenerator() {
        for (const event of mockEvents) {
          yield event;
        }
      }

      mockMessagesStream.mockReturnValue(mockGenerator());

      const chunks: string[] = [];
      for await (const chunk of streamResponse('System prompt', [
        { role: 'user', content: 'Test' },
      ])) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Visible text']);
    });

    it('handles empty stream gracefully', async () => {
      const { streamResponse } = await import('@/lib/claude');

      async function* mockGenerator() {
        // Empty generator
      }

      mockMessagesStream.mockReturnValue(mockGenerator());

      const chunks: string[] = [];
      for await (const chunk of streamResponse('System prompt', [
        { role: 'user', content: 'Empty test' },
      ])) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([]);
    });

    it('throws error when API key is not set', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      vi.resetModules();

      const { streamResponse } = await import('@/lib/claude');

      const generator = streamResponse('System prompt', [{ role: 'user', content: 'Test' }]);

      await expect(generator.next()).rejects.toThrow(
        'Claude client not initialized — set ANTHROPIC_API_KEY'
      );
    });

    it('propagates streaming errors from Anthropic SDK', async () => {
      const { streamResponse } = await import('@/lib/claude');

      async function* errorGenerator() {
        throw new Error('Stream interrupted');
      }

      mockMessagesStream.mockReturnValue(errorGenerator());

      const generator = streamResponse('System prompt', [{ role: 'user', content: 'Test' }]);

      await expect(generator.next()).rejects.toThrow('Stream interrupted');
    });

    it('passes tools to messages.stream when provided', async () => {
      const { streamResponse, WEB_SEARCH_TOOL } = await import('@/lib/claude');

      async function* mockGenerator() {
        yield {
          type: 'content_block_delta' as const,
          delta: { type: 'text_delta' as const, text: 'Hello' },
        };
      }

      mockMessagesStream.mockReturnValue(mockGenerator());

      const chunks: string[] = [];
      for await (const chunk of streamResponse(
        'System prompt',
        [{ role: 'user', content: 'Test' }],
        { tools: [WEB_SEARCH_TOOL] }
      )) {
        chunks.push(chunk);
      }

      expect(mockMessagesStream).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        })
      );
    });

    it('does not pass tools to stream when undefined', async () => {
      const { streamResponse } = await import('@/lib/claude');

      async function* mockGenerator() {
        // Empty
      }

      mockMessagesStream.mockReturnValue(mockGenerator());

      for await (const _ of streamResponse('System prompt', [
        { role: 'user', content: 'Test' },
      ])) {
        // consume
      }

      const callArg = mockMessagesStream.mock.calls[0][0];
      expect(callArg).not.toHaveProperty('tools');
    });
  });

  describe('claude-code delegation', () => {
    it('generateResponse delegates to claude-code-client when AI_PROVIDER=claude-code', async () => {
      process.env.AI_PROVIDER = 'claude-code';
      delete process.env.ANTHROPIC_API_KEY;
      vi.resetModules();

      const mockExecute = vi.fn().mockResolvedValue({
        content: 'CLI response',
        inputTokens: 0,
        outputTokens: 0,
      });
      const mockSerialize = vi.fn().mockReturnValue('serialized prompt');

      vi.doMock('@/lib/claude-code-client', () => ({
        executeClaudeCode: mockExecute,
        serializeMessages: mockSerialize,
      }));

      const { generateResponse } = await import('@/lib/claude');

      const result = await generateResponse('System prompt', [{ role: 'user', content: 'Hello' }]);

      expect(result.content).toBe('CLI response');
      expect(result.inputTokens).toBe(0);
      expect(result.outputTokens).toBe(0);
      // Anthropic SDK should NOT be called
      expect(mockMessagesCreate).not.toHaveBeenCalled();
    });

    it('streamResponse delegates to claude-code-client when AI_PROVIDER=claude-code', async () => {
      process.env.AI_PROVIDER = 'claude-code';
      delete process.env.ANTHROPIC_API_KEY;
      vi.resetModules();

      async function* mockStream() {
        yield 'chunk1';
        yield 'chunk2';
      }

      const mockStreamFn = vi.fn().mockReturnValue(mockStream());
      const mockSerialize = vi.fn().mockReturnValue('serialized prompt');

      vi.doMock('@/lib/claude-code-client', () => ({
        streamClaudeCode: mockStreamFn,
        serializeMessages: mockSerialize,
      }));

      const { streamResponse } = await import('@/lib/claude');

      const chunks: string[] = [];
      for await (const chunk of streamResponse('System', [{ role: 'user', content: 'Test' }])) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['chunk1', 'chunk2']);
      expect(mockStreamFn).toHaveBeenCalled();
      // Anthropic SDK should NOT be called
      expect(mockMessagesStream).not.toHaveBeenCalled();
    });

    it('does not warn about missing API key when AI_PROVIDER=claude-code', async () => {
      process.env.AI_PROVIDER = 'claude-code';
      delete process.env.ANTHROPIC_API_KEY;
      vi.resetModules();

      vi.doMock('@/lib/claude-code-client', () => ({
        executeClaudeCode: vi
          .fn()
          .mockResolvedValue({ content: '', inputTokens: 0, outputTokens: 0 }),
        serializeMessages: vi.fn().mockReturnValue(''),
        streamClaudeCode: vi.fn(),
      }));

      await import('@/lib/claude');
      const { logger } = await import('@/lib/logger');

      expect(logger.warn).not.toHaveBeenCalledWith(
        'ANTHROPIC_API_KEY is not set — Claude features will not work'
      );
    });

  });

  describe('logApiUsage', () => {
    beforeEach(() => {
      mockApiUsageLogCreate.mockClear();
    });

    it('persists API usage to database with cost calculation', async () => {
      const { logApiUsage } = await import('@/lib/claude');

      await logApiUsage({
        category: 'script-generation',
        inputTokens: 1000,
        outputTokens: 2000,
      });

      expect(mockApiUsageLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          service: 'anthropic',
          category: 'script-generation',
          inputTokens: 1000,
          outputTokens: 2000,
          totalCost: expect.closeTo(0.033, 6),
        }),
      });
    });

    it('includes podcastId when provided', async () => {
      const { logApiUsage } = await import('@/lib/claude');

      await logApiUsage({
        podcastId: 'podcast-123',
        category: 'discovery',
        inputTokens: 500,
        outputTokens: 1000,
      });

      expect(mockApiUsageLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          podcastId: 'podcast-123',
          category: 'discovery',
        }),
      });
    });

    it('includes userId when provided', async () => {
      const { logApiUsage } = await import('@/lib/claude');

      await logApiUsage({
        userId: 'user-456',
        category: 'interaction',
        inputTokens: 200,
        outputTokens: 300,
      });

      expect(mockApiUsageLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-456',
          category: 'interaction',
          inputTokens: 200,
          outputTokens: 300,
          totalCost: expect.closeTo(0.0051, 6),
        }),
      });
    });

    it('calculates cost correctly for Claude Sonnet 4.5 pricing', async () => {
      const { logApiUsage } = await import('@/lib/claude');

      // Input: $3.00 per million tokens
      // Output: $15.00 per million tokens
      await logApiUsage({
        category: 'test',
        inputTokens: 1_000_000, // Should cost $3.00
        outputTokens: 1_000_000, // Should cost $15.00
      });

      expect(mockApiUsageLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          totalCost: 18,
        }),
      });
    });

    it('handles zero tokens', async () => {
      const { logApiUsage } = await import('@/lib/claude');

      await logApiUsage({
        category: 'test',
        inputTokens: 0,
        outputTokens: 0,
      });

      expect(mockApiUsageLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          totalCost: 0,
        }),
      });
    });

    it('includes durationMs when provided', async () => {
      const { logApiUsage } = await import('@/lib/claude');

      await logApiUsage({
        category: 'performance-test',
        inputTokens: 100,
        outputTokens: 200,
        durationMs: 1500,
      });

      expect(mockApiUsageLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          durationMs: 1500,
          totalCost: expect.closeTo(0.0033, 6),
        }),
      });
    });

    it('handles fractional costs correctly', async () => {
      const { logApiUsage } = await import('@/lib/claude');

      await logApiUsage({
        category: 'small-request',
        inputTokens: 10,
        outputTokens: 20,
      });

      // 10 / 1_000_000 * 3.0 + 20 / 1_000_000 * 15.0 = 0.00003 + 0.0003 = 0.00033
      expect(mockApiUsageLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          totalCost: expect.closeTo(0.00033, 6),
        }),
      });
    });
  });
});
