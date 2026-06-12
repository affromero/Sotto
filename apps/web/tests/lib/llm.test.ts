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

// Prevent claude-code-client from spawning a real CLI process in tests
vi.mock('@/lib/claude-code-client', () => ({
  executeClaudeCode: vi.fn().mockResolvedValue({ content: '', inputTokens: 0, outputTokens: 0 }),
  serializeMessages: vi.fn().mockReturnValue(''),
  streamClaudeCode: vi.fn(),
}));

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

// ---- Tests ----

describe('claude', () => {
  let originalApiKey: string | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    originalApiKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-api-key-123';
    // Clear module cache to force re-import
    vi.resetModules();
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = originalApiKey;
  });

  describe('generateResponse', () => {
    it('generates a non-streaming response with default options', async () => {
      const { generateResponse } = await import('@/lib/llm');

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
      ], { model: DEFAULT_MODEL });

      expect(result).toEqual({
        content: 'This is a test response from Claude.',
        inputTokens: 150,
        outputTokens: 75,
        model: DEFAULT_MODEL,
      });
    });

    it('requires an explicit model', async () => {
      const { generateResponse } = await import('@/lib/llm');

      await expect(
        generateResponse('System prompt', [{ role: 'user', content: 'Test' }])
      ).rejects.toThrow('AI model is required for generateResponse.');
    });

    it('returns empty content when response has no text block', async () => {
      const { generateResponse } = await import('@/lib/llm');

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
      ], { model: DEFAULT_MODEL });

      expect(result.content).toBe('');
      expect(result.inputTokens).toBe(50);
      expect(result.outputTokens).toBe(10);
    });

    it('extracts text from first text block when multiple blocks exist', async () => {
      const { generateResponse } = await import('@/lib/llm');

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
      ], { model: DEFAULT_MODEL });

      expect(result.content).toBe('First text block\n\nSecond text block');
    });

    it('throws error when API key is not set', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      vi.resetModules();

      const { generateResponse } = await import('@/lib/llm');

      await expect(
        generateResponse('System prompt', [{ role: 'user', content: 'Test' }], { model: DEFAULT_MODEL })
      ).rejects.toThrow('LLM client not initialized — set ANTHROPIC_API_KEY');
    });

    it('propagates API errors from Anthropic SDK', async () => {
      const { generateResponse } = await import('@/lib/llm');

      const apiError = new Error('Rate limit exceeded');
      mockMessagesCreate.mockRejectedValue(apiError);

      await expect(
        generateResponse('System prompt', [{ role: 'user', content: 'Test' }], { model: DEFAULT_MODEL })
      ).rejects.toThrow('Rate limit exceeded');
    });

    it('throws on unknown model ID instead of sending to Anthropic', async () => {
      const { generateResponse } = await import('@/lib/llm');

      await expect(
        generateResponse('System prompt', [{ role: 'user', content: 'Test' }], {
          model: 'nonexistent-model-xyz',
        })
      ).rejects.toThrow('Unknown AI model ID: "nonexistent-model-xyz"');
    });

    it('accepts tools option without error', async () => {
      const { generateResponse, WEB_SEARCH_TOOL } = await import('@/lib/llm');

      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text' as const, text: 'Response with tools' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const result = await generateResponse('System prompt', [{ role: 'user', content: 'Test' }], {
        tools: [WEB_SEARCH_TOOL],
        model: DEFAULT_MODEL,
      });

      expect(result.content).toBe('Response with tools');
    });
  });

  describe('streamResponse', () => {
    it('streams text deltas from Claude', async () => {
      const { streamResponse } = await import('@/lib/llm');

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
      ], { model: DEFAULT_MODEL })) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hello ', 'from ', 'Claude!']);
    });

    it('requires an explicit stream model', async () => {
      const { streamResponse } = await import('@/lib/llm');

      const generator = streamResponse('System prompt', [{ role: 'user', content: 'Test' }]);

      await expect(generator.next()).rejects.toThrow('AI model is required for streamResponse.');
    });

    it('ignores non-text-delta events', async () => {
      const { streamResponse } = await import('@/lib/llm');

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
      ], { model: DEFAULT_MODEL })) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Visible text']);
    });

    it('handles empty stream gracefully', async () => {
      const { streamResponse } = await import('@/lib/llm');

      async function* mockGenerator() {
        // Empty generator
      }

      mockMessagesStream.mockReturnValue(mockGenerator());

      const chunks: string[] = [];
      for await (const chunk of streamResponse('System prompt', [
        { role: 'user', content: 'Empty test' },
      ], { model: DEFAULT_MODEL })) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([]);
    });

    it('throws error when API key is not set', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      vi.resetModules();

      const { streamResponse } = await import('@/lib/llm');

      const generator = streamResponse('System prompt', [{ role: 'user', content: 'Test' }], { model: DEFAULT_MODEL });

      await expect(generator.next()).rejects.toThrow(
        'LLM client not initialized — set ANTHROPIC_API_KEY'
      );
    });

    it('propagates streaming errors from Anthropic SDK', async () => {
      const { streamResponse } = await import('@/lib/llm');

      async function* errorGenerator() {
        throw new Error('Stream interrupted');
      }

      mockMessagesStream.mockReturnValue(errorGenerator());

      const generator = streamResponse('System prompt', [{ role: 'user', content: 'Test' }], { model: DEFAULT_MODEL });

      await expect(generator.next()).rejects.toThrow('Stream interrupted');
    });

    it('throws on unknown model ID instead of sending to Anthropic', async () => {
      const { streamResponse } = await import('@/lib/llm');

      const generator = streamResponse('System prompt', [{ role: 'user', content: 'Test' }], {
        model: 'nonexistent-model-xyz',
      });

      await expect(generator.next()).rejects.toThrow('Unknown AI model ID: "nonexistent-model-xyz"');
    });

    it('streams text when tools option is provided', async () => {
      const { streamResponse, WEB_SEARCH_TOOL } = await import('@/lib/llm');

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
        { tools: [WEB_SEARCH_TOOL], model: DEFAULT_MODEL }
      )) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hello']);
    });
  });

  describe('logUsage (usage-logger)', () => {
    beforeEach(() => {
      mockApiUsageLogCreate.mockClear();
    });

    it('computes AI cost from model pricing and persists to database', async () => {
      const { logUsage } = await import('@/lib/usage-logger');

      await logUsage({
        service: 'anthropic',
        model: 'claude-sonnet-4-6',
        category: 'script_generation',
        inputTokens: 1000,
        outputTokens: 2000,
      });

      expect(mockApiUsageLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          service: 'anthropic',
          modelId: 'claude-sonnet-4-6',
          category: 'script_generation',
          inputTokens: 1000,
          outputTokens: 2000,
          totalCost: expect.closeTo(0.033, 6),
        }),
      });
    });

    it('uses explicit totalCost when provided (TTS/STT)', async () => {
      const { logUsage } = await import('@/lib/usage-logger');

      await logUsage({
        service: 'elevenlabs',
        category: 'audio_generation',
        inputTokens: 500,
        totalCost: 0.085,
        episodeId: 'episode-123',
      });

      expect(mockApiUsageLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          service: 'elevenlabs',
          totalCost: 0.085,
          episodeId: 'episode-123',
        }),
      });
    });

    it('handles Haiku pricing correctly', async () => {
      const { logUsage } = await import('@/lib/usage-logger');

      await logUsage({
        service: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        category: 'script_generation',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      });

      // Haiku: $1.00 input + $5.00 output = $6.00
      expect(mockApiUsageLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          totalCost: expect.closeTo(6.0, 2),
          modelId: 'claude-haiku-4-5-20251001',
        }),
      });
    });

    it('defaults to 0 cost for unknown non-AI services without totalCost', async () => {
      const { logUsage } = await import('@/lib/usage-logger');

      await logUsage({
        service: 'ffmpeg',
        category: 'stitching',
      });

      expect(mockApiUsageLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          service: 'ffmpeg',
          totalCost: 0,
        }),
      });
    });
  });
});
