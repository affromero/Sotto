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

// ---- Tests ----

describe('claude', () => {
  let originalApiKey: string | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    originalApiKey = process.env.ANTHROPIC_API_KEY;
    // Set API key before importing module
    process.env.ANTHROPIC_API_KEY = 'test-api-key-123';
    // Clear module cache to force re-import
    vi.resetModules();
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = originalApiKey;
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

      expect(mockMessagesCreate).toHaveBeenCalledWith({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        system: 'You are a helpful assistant.',
        messages: [{ role: 'user', content: 'Hello, Claude!' }],
      });
    });

    it('uses custom maxTokens option when provided', async () => {
      const { generateResponse } = await import('@/lib/claude');

      const mockResponse = {
        content: [
          {
            type: 'text' as const,
            text: 'Short response',
          },
        ],
        usage: {
          input_tokens: 50,
          output_tokens: 20,
        },
      };

      mockMessagesCreate.mockResolvedValue(mockResponse);

      await generateResponse(
        'You are a helpful assistant.',
        [{ role: 'user', content: 'Brief answer please' }],
        { maxTokens: 512 }
      );

      expect(mockMessagesCreate).toHaveBeenCalledWith({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 512,
        system: 'You are a helpful assistant.',
        messages: [{ role: 'user', content: 'Brief answer please' }],
      });
    });

    it('uses custom model option when provided', async () => {
      const { generateResponse } = await import('@/lib/claude');

      const mockResponse = {
        content: [
          {
            type: 'text' as const,
            text: 'Response from Opus',
          },
        ],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
        },
      };

      mockMessagesCreate.mockResolvedValue(mockResponse);

      await generateResponse(
        'You are a helpful assistant.',
        [{ role: 'user', content: 'Use Opus' }],
        { model: 'claude-opus-4-6' }
      );

      expect(mockMessagesCreate).toHaveBeenCalledWith({
        model: 'claude-opus-4-6',
        max_tokens: 4096,
        system: 'You are a helpful assistant.',
        messages: [{ role: 'user', content: 'Use Opus' }],
      });
    });

    it('handles multi-turn conversations', async () => {
      const { generateResponse } = await import('@/lib/claude');

      const mockResponse = {
        content: [
          {
            type: 'text' as const,
            text: 'I remember what we discussed earlier.',
          },
        ],
        usage: {
          input_tokens: 300,
          output_tokens: 80,
        },
      };

      mockMessagesCreate.mockResolvedValue(mockResponse);

      const messages = [
        { role: 'user' as const, content: 'Tell me about quantum computing' },
        {
          role: 'assistant' as const,
          content: 'Quantum computing uses qubits...',
        },
        { role: 'user' as const, content: 'Can you elaborate on qubits?' },
      ];

      await generateResponse('You are an expert physicist.', messages);

      expect(mockMessagesCreate).toHaveBeenCalledWith({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        system: 'You are an expert physicist.',
        messages,
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

      expect(result.content).toBe('First text block');
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
      expect(mockMessagesStream).toHaveBeenCalledWith({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        system: 'System prompt',
        messages: [{ role: 'user', content: 'Stream test' }],
      });
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

    it('uses custom options when provided', async () => {
      const { streamResponse } = await import('@/lib/claude');

      async function* mockGenerator() {
        yield {
          type: 'content_block_delta' as const,
          delta: {
            type: 'text_delta' as const,
            text: 'Custom options test',
          },
        };
      }

      mockMessagesStream.mockReturnValue(mockGenerator());

      const chunks: string[] = [];
      for await (const chunk of streamResponse(
        'Custom system prompt',
        [{ role: 'user', content: 'Test' }],
        { maxTokens: 1024, model: 'claude-opus-4-6' }
      )) {
        chunks.push(chunk);
      }

      expect(mockMessagesStream).toHaveBeenCalledWith({
        model: 'claude-opus-4-6',
        max_tokens: 1024,
        system: 'Custom system prompt',
        messages: [{ role: 'user', content: 'Test' }],
      });
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
  });

  describe('logApiUsage', () => {
    it('logs API usage with cost calculation', async () => {
      const { logApiUsage } = await import('@/lib/claude');
      const { logger } = await import('@/lib/logger');

      await logApiUsage({
        category: 'script-generation',
        inputTokens: 1000,
        outputTokens: 2000,
      });

      expect(logger.info).toHaveBeenCalledWith('AI API usage', {
        category: 'script-generation',
        inputTokens: '1000',
        outputTokens: '2000',
        totalCost: '0.033',
      });
    });

    it('includes podcastId when provided', async () => {
      const { logApiUsage } = await import('@/lib/claude');
      const { logger } = await import('@/lib/logger');

      await logApiUsage({
        podcastId: 'podcast-123',
        category: 'discovery',
        inputTokens: 500,
        outputTokens: 1000,
      });

      expect(logger.info).toHaveBeenCalledWith('AI API usage', {
        category: 'discovery',
        inputTokens: '500',
        outputTokens: '1000',
        totalCost: '0.0165',
      });
    });

    it('includes userId when provided', async () => {
      const { logApiUsage } = await import('@/lib/claude');
      const { logger } = await import('@/lib/logger');

      await logApiUsage({
        userId: 'user-456',
        category: 'interaction',
        inputTokens: 200,
        outputTokens: 300,
      });

      const callArgs = (logger.info as any).mock.calls[0];
      expect(callArgs[0]).toBe('AI API usage');
      expect(callArgs[1].category).toBe('interaction');
      expect(callArgs[1].inputTokens).toBe('200');
      expect(callArgs[1].outputTokens).toBe('300');
      expect(parseFloat(callArgs[1].totalCost)).toBeCloseTo(0.0051, 6);
    });

    it('calculates cost correctly for Claude Sonnet 4.5 pricing', async () => {
      const { logApiUsage } = await import('@/lib/claude');
      const { logger } = await import('@/lib/logger');

      // Input: $3.00 per million tokens
      // Output: $15.00 per million tokens
      await logApiUsage({
        category: 'test',
        inputTokens: 1_000_000, // Should cost $3.00
        outputTokens: 1_000_000, // Should cost $15.00
      });

      expect(logger.info).toHaveBeenCalledWith('AI API usage', {
        category: 'test',
        inputTokens: '1000000',
        outputTokens: '1000000',
        totalCost: '18',
      });
    });

    it('handles zero tokens', async () => {
      const { logApiUsage } = await import('@/lib/claude');
      const { logger } = await import('@/lib/logger');

      await logApiUsage({
        category: 'test',
        inputTokens: 0,
        outputTokens: 0,
      });

      expect(logger.info).toHaveBeenCalledWith('AI API usage', {
        category: 'test',
        inputTokens: '0',
        outputTokens: '0',
        totalCost: '0',
      });
    });

    it('includes durationMs when provided', async () => {
      const { logApiUsage } = await import('@/lib/claude');
      const { logger } = await import('@/lib/logger');

      await logApiUsage({
        category: 'performance-test',
        inputTokens: 100,
        outputTokens: 200,
        durationMs: 1500,
      });

      expect(logger.info).toHaveBeenCalledWith('AI API usage', {
        category: 'performance-test',
        inputTokens: '100',
        outputTokens: '200',
        totalCost: '0.0033',
      });
    });

    it('handles fractional costs correctly', async () => {
      const { logApiUsage } = await import('@/lib/claude');
      const { logger } = await import('@/lib/logger');

      await logApiUsage({
        category: 'small-request',
        inputTokens: 10,
        outputTokens: 20,
      });

      const callArgs = (logger.info as any).mock.calls[0];
      expect(callArgs[0]).toBe('AI API usage');
      expect(callArgs[1].category).toBe('small-request');
      expect(callArgs[1].inputTokens).toBe('10');
      expect(callArgs[1].outputTokens).toBe('20');
      // 10 / 1_000_000 * 3.0 + 20 / 1_000_000 * 15.0 = 0.00003 + 0.0003 = 0.00033
      expect(parseFloat(callArgs[1].totalCost)).toBeCloseTo(0.00033, 6);
    });
  });
});
