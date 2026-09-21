// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import type { TokenUsage } from 'thesidedoor-core/ai';
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
const mockApiUsageLogCreate = vi.fn().mockResolvedValue({});
vi.mock('@/lib/prisma', () => ({
  prisma: { apiUsageLog: { create: (...args: unknown[]) => mockApiUsageLogCreate(...args) } },
}));
vi.mock('@/lib/site-config', () => ({
  getSiteConfig: async () => ({ aiBaseUrl: null, aiModel: null }),
}));
vi.mock('@/lib/claude-code-client', () => ({
  isClaudeCleanupError: () => false,
  executeClaudeCode: vi.fn(),
  streamClaudeCode: vi.fn(),
}));
vi.mock('@/lib/codex-client', () => ({
  isCodexCleanupError: () => false,
  executeCodex: async () => ({
    content: 'Codex answer',
    inputTokens: 20,
    outputTokens: null,
    model: 'codex:captured#effort=high',
  }),
  async *streamCodex(
    system: string,
    prompt: string,
    options?: { onUsage?: (usage: TokenUsage & { model: string }) => void }
  ) {
    yield system + prompt;
    options?.onUsage?.({
      inputTokens: 20,
      outputTokens: null,
      model: 'codex:captured#effort=high',
    });
  },
}));
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const options = {
  model: DEFAULT_MODEL,
  skipModeration: true,
  apiKeyOverride: 'test-api-key',
  endpoint: 'https://api.anthropic.com',
};
function message(content: unknown[] = [{ type: 'text', text: 'Answer' }], stop = 'end_turn') {
  return {
    id: 'message1',
    type: 'message',
    role: 'assistant',
    model: DEFAULT_MODEL,
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: {
      input_tokens: 150,
      output_tokens: 75,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  };
}
function streamed(texts: string[] = ['Hello', ' world'], stop = 'end_turn') {
  const events: Array<{ type: string; [key: string]: unknown }> = [
    {
      type: 'message_start',
      message: {
        ...message([]),
        stop_reason: null,
        usage: {
          input_tokens: 150,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    },
  ];
  texts.forEach((text, index) =>
    events.push(
      { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index, delta: { type: 'text_delta', text } },
      { type: 'content_block_stop', index }
    )
  );
  events.push(
    {
      type: 'message_delta',
      delta: { stop_reason: stop, stop_sequence: null },
      usage: { output_tokens: 75 },
    },
    { type: 'message_stop' }
  );
  return new Response(
    events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
    {
      headers: { 'content-type': 'text/event-stream' },
    }
  );
}
async function textOf(stream: AsyncIterable<string>) {
  let text = '';
  for await (const chunk of stream) text += chunk;
  return text;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('LLM routing through shared providers', () => {
  it('reports unconfirmed cleanup when an SDK retry sleep outlasts cancellation cleanup', async () => {
    const controller = new AbortController();
    let sent = 0;
    let abortTimer: ReturnType<typeof setTimeout> | undefined;
    vi.stubGlobal('fetch', async () => {
      sent += 1;
      abortTimer = setTimeout(() => controller.abort(), 20);
      return Response.json(
        { error: { type: 'overloaded_error', message: 'Retry later' } },
        {
          status: 529,
          headers: { 'retry-after': '6' },
        }
      );
    });
    const llm = await import('@/lib/llm');
    const completions: TokenUsage[] = [];
    try {
      await expect(
        textOf(
          llm.streamResponse('', [], {
            ...options,
            signal: controller.signal,
            onComplete: (usage) => completions.push(usage),
          })
        )
      ).rejects.toMatchObject({ cause: { cause: { code: 'cleanup_failed', unconfirmed: true } } });
      await delay(1100);
      expect(sent).toBe(1);
      expect(completions).toEqual([]);
    } finally {
      clearTimeout(abortTimer);
    }
  }, 10_000);
  it.each(['gpt-5.4', 'local:chosen', 'codex', 'claude-code:sonnet'])(
    'rejects restricted search instead of broadening it when routed to %s',
    async (model) => {
      let sent = false;
      vi.stubGlobal('fetch', async () => {
        sent = true;
        return Response.json(message());
      });
      const llm = await import('@/lib/llm');
      const selected = {
        ...options,
        model,
        tools: [{ ...llm.WEB_SEARCH_TOOL, allowed_domains: ['example.com'] }],
      };
      await expect(llm.generateResponse('', [], selected)).rejects.toThrow('cannot preserve');
      await expect(textOf(llm.streamResponse('', [], selected))).rejects.toThrow('cannot preserve');
      expect(sent).toBe(false);
    }
  );
  it.each([false, true])(
    'finishes paused search turns and reports combined usage (streaming=%s)',
    async (streaming) => {
      const bodies: Array<Record<string, unknown>> = [];
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe('https://api.anthropic.com/v1/messages');
        bodies.push(JSON.parse(String(init?.body)));
        const first = bodies.length === 1;
        const text = first ? 'First' : 'Last';
        const stop = first ? 'pause_turn' : 'end_turn';
        return streaming
          ? streamed([text], stop)
          : Response.json(message([{ type: 'text', text }], stop));
      });
      const llm = await import('@/lib/llm');
      const usage: TokenUsage[] = [];
      const selected = {
        ...options,
        tools: [{ ...llm.WEB_SEARCH_TOOL, allowed_domains: ['example.com'] }],
      };
      if (streaming) {
        expect(
          await textOf(
            llm.streamResponse('', [], {
              ...selected,
              onComplete: (value) => usage.push(value),
            })
          )
        ).toBe('FirstLast');
      } else {
        expect(
          await llm.generateResponse('', [], {
            ...selected,
            onUsage: (value) => usage.push(value),
          })
        ).toMatchObject({ content: 'First\n\nLast' });
      }
      expect(usage).toEqual([expect.objectContaining({ inputTokens: 300, outputTokens: 150 })]);
      expect(bodies).toHaveLength(2);
      expect(bodies[1]?.tools).toEqual(bodies[0]?.tools);
      expect(bodies[1]?.messages).toEqual([
        {
          role: 'assistant',
          content: [expect.objectContaining({ type: 'text', text: 'First' })],
        },
      ]);
    }
  );
  it('recovers from connection failures within the Anthropic SDK retry policy', async () => {
    let attempts = 0;
    vi.stubGlobal('fetch', async () => {
      attempts += 1;
      if (attempts < 3) throw new TypeError('Connection reset');
      return Response.json(message());
    });
    const llm = await import('@/lib/llm');
    expect(await llm.generateResponse('', [], options)).toMatchObject({
      content: 'Answer',
      inputTokens: 150,
      outputTokens: 75,
    });
  });
  it.each([false, true])(
    'cancels Anthropic SDK backoff without sending another request (streaming=%s)',
    async (streaming) => {
      const controller = new AbortController();
      let sent = 0;
      let abortTimer: ReturnType<typeof setTimeout> | undefined;
      vi.stubGlobal('fetch', async () => {
        sent += 1;
        abortTimer = setTimeout(() => controller.abort(new Error('Cancelled by caller')), 20);
        return Response.json(
          { error: { type: 'overloaded_error', message: 'Retry later' } },
          {
            status: 529,
            headers: { 'retry-after': '2' },
          }
        );
      });
      const llm = await import('@/lib/llm');
      try {
        const selected = { ...options, signal: controller.signal };
        await expect(
          streaming
            ? textOf(llm.streamResponse('', [], selected))
            : llm.generateResponse('', [], selected)
        ).rejects.toThrow('Cancelled by caller');
        expect(sent).toBe(1);
      } finally {
        clearTimeout(abortTimer);
      }
    }
  );
  it('preserves captured Codex identity and unknown usage', async () => {
    const llm = await import('@/lib/llm');
    expect(
      await llm.generateResponse('', [{ role: 'user', content: 'Prompt' }], {
        ...options,
        model: 'codex',
      })
    ).toEqual({
      content: 'Codex answer',
      inputTokens: 20,
      outputTokens: null,
      model: 'codex:captured#effort=high',
    });
    const completions: unknown[] = [];
    await textOf(
      llm.streamResponse('', [{ role: 'user', content: 'Prompt' }], {
        ...options,
        model: 'codex',
        onComplete: (usage) => completions.push(usage),
      })
    );
    expect(completions).toEqual([
      { inputTokens: 20, outputTokens: null, model: 'codex:captured#effort=high' },
    ]);
  });
  it('preserves defaults, images, hosted search and schemas on one request', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.anthropic.com/v1/messages');
      expect(new Headers(init?.headers).get('x-api-key')).toBe('test-api-key');
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        model: DEFAULT_MODEL,
        max_tokens: 4096,
        system: 'system',
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'url', url: 'https://images.example/a.png?signature=A%2Fb' },
              },
            ],
          },
        ],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        output_config: { format: { type: 'json_schema', schema: { type: 'object' } } },
      });
      expect(body.tools[0]).not.toHaveProperty('max_uses');
      return Response.json(message());
    });
    const llm = await import('@/lib/llm');
    expect(
      await llm.generateResponse(
        'system',
        [
          {
            role: 'user',
            content: [{ type: 'image_url', url: 'https://images.example/a.png?signature=A%2Fb' }],
          },
        ],
        {
          ...options,
          tools: [llm.WEB_SEARCH_TOOL],
          temperature: 0,
          jsonSchema: { name: 'result', schema: { type: 'object' } },
        }
      )
    ).toMatchObject({
      content: 'Answer',
      inputTokens: 150,
      outputTokens: 75,
      model: DEFAULT_MODEL,
    });
  });
  it.each([true, false])(
    'joins actual text blocks while ignoring tool blocks: %s',
    async (includeText) => {
      vi.stubGlobal('fetch', async () =>
        Response.json(
          message(
            [
              ...(includeText ? [{ type: 'text', text: 'First' }] : []),
              { type: 'tool_use', id: 'tool1', name: 'lookup', input: {} },
              ...(includeText ? [{ type: 'text', text: 'Second' }] : []),
            ],
            'tool_use'
          )
        )
      );
      const llm = await import('@/lib/llm');
      expect(await llm.generateResponse('', [], options)).toMatchObject({
        content: includeText ? 'First\n\nSecond' : '',
        inputTokens: 150,
        outputTokens: 75,
      });
    }
  );
  it.each(['generate', 'stream'])(
    'validates explicit registered models and credentials for %s',
    async (mode) => {
      const llm = await import('@/lib/llm');
      for (const model of [undefined, 'unregistered-model']) {
        await expect(
          mode === 'generate'
            ? llm.generateResponse('', [], { skipModeration: true, model })
            : textOf(llm.streamResponse('', [], { skipModeration: true, model }))
        ).rejects.toThrow(model ? 'Unknown AI model ID' : 'AI model is required');
      }
      const missing = await import('@/lib/llm');
      await expect(
        mode === 'generate'
          ? missing.generateResponse('', [], { ...options, apiKeyOverride: undefined })
          : textOf(missing.streamResponse('', [], { ...options, apiKeyOverride: undefined }))
      ).rejects.toThrow('A captured Anthropic credential is required');
    }
  );
  it.each(['generate', 'stream'])('preserves provider HTTP errors for %s', async (mode) => {
    vi.stubGlobal('fetch', async () =>
      Response.json(
        { type: 'error', error: { type: 'authentication_error', message: 'Denied' } },
        { status: 401 }
      )
    );
    const llm = await import('@/lib/llm');
    await expect(
      mode === 'generate'
        ? llm.generateResponse('', [], options)
        : textOf(llm.streamResponse('', [], options))
    ).rejects.toMatchObject({ status: 401 });
  });
  it.each([false, true])(
    'preserves platform versus override endpoint capture: %s',
    async (override) => {
      const llm = await import('@/lib/llm');
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe(
          `https://${override ? 'request' : 'captured'}.example/team/v1/messages`
        );
        expect(new Headers(init?.headers).get('x-api-key')).toBe(
          override ? 'override-key' : 'test-api-key'
        );
        return Response.json(message());
      });
      await llm.generateResponse('', [], {
        ...options,
        apiKeyOverride: override ? 'override-key' : 'test-api-key',
        endpoint: `https://${override ? 'request' : 'captured'}.example/team/`,
      });
    }
  );
  it('preserves search restrictions through the shared backend', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.anthropic.com/v1/messages');
      expect(JSON.parse(String(init?.body)).tools).toEqual([
        {
          type: 'web_search_20250305',
          name: 'web_search',
          allowed_domains: ['example.com'],
          max_uses: 8,
          user_location: { type: 'approximate', city: 'Chicago', country: 'US' },
        },
      ]);
      return Response.json(message());
    });
    const llm = await import('@/lib/llm');
    await expect(
      llm.generateResponse('', [], {
        ...options,
        tools: [
          {
            ...llm.WEB_SEARCH_TOOL,
            allowed_domains: ['example.com'],
            max_uses: 8,
            user_location: { type: 'approximate' as const, city: 'Chicago', country: 'US' },
          },
        ],
      })
    ).resolves.toMatchObject({ content: 'Answer', inputTokens: 150, outputTokens: 75 });
  });
  it.each([{ texts: ['Hello', ' world'] }, { texts: [] }])(
    'streams text without artificial separators: %j',
    async ({ texts }) => {
      vi.stubGlobal('fetch', async () => streamed(texts));
      const llm = await import('@/lib/llm');
      const completions: unknown[] = [];
      expect(
        await textOf(
          llm.streamResponse('', [], { ...options, onComplete: (usage) => completions.push(usage) })
        )
      ).toBe(texts.join(''));
      expect(completions).toEqual([
        expect.objectContaining({ model: DEFAULT_MODEL, inputTokens: 150, outputTokens: 75 }),
      ]);
    }
  );
  it('preserves partial max-token output', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json(message([{ type: 'text', text: 'Partial' }], 'max_tokens'))
    );
    const llm = await import('@/lib/llm');
    expect(await llm.generateResponse('', [], options)).toMatchObject({
      content: 'Partial',
      inputTokens: 150,
      outputTokens: 75,
    });
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

  it('preserves unknown cost for services without a reported cost', async () => {
    const { logUsage } = await import('@/lib/usage-logger');

    await logUsage({
      service: 'ffmpeg',
      category: 'stitching',
    });

    expect(mockApiUsageLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        service: 'ffmpeg',
        totalCost: null,
      }),
    });
  });
});
