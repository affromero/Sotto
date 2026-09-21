// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
const serverConfiguration = vi.hoisted(() => ({ values: {} as Record<string, string | null> }));
vi.mock('@/lib/site-config', () => ({
  getSiteConfig: async () => serverConfiguration.values,
}));
vi.mock('@/lib/server-config', () => ({
  getServerInfra: async () => serverConfiguration.values,
  infra: (key: string) => serverConfiguration.values[key] ?? undefined,
}));
import {
  generateSharedApi,
  streamSharedApi,
  streamSharedApiWithRetry,
  type SharedApiSelection,
} from '@/lib/providers/shared/shared-api';
import { usageFromGenerationError } from 'thesidedoor-core/ai/usage';

const selection: SharedApiSelection = {
  descriptor: {
    id: 'local',
    label: 'Local',
    transport: 'local',
    fields: [],
    models: [],
    capabilities: ['text', 'vision', 'structured'],
  },
  transport: 'compatible',
  credentials: { apiKey: 'selected-key' },
  model: 'selected-model',
  baseUrl: 'https://models.example/team/inference',
};
afterEach(() => {
  serverConfiguration.values = {};
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('shared API execution', () => {
  it('uses the selected compatible provider credential', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.groq.com/openai/v1/chat/completions');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer groq-owner-key');
      return Response.json({
        choices: [
          { message: { role: 'assistant', content: 'Selected service' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 2 },
      });
    });
    const { createAIProvider } = await import('@/lib/providers/ai');
    expect(
      await createAIProvider('groq').generateResponse('', [], {
        model: 'chosen-model',
        apiKeyOverride: 'groq-owner-key',
        skipModeration: true,
      })
    ).toMatchObject({ content: 'Selected service', model: 'chosen-model' });
  });
  it.each([false, true])(
    'keeps the configured OpenAI endpoint, key and model across retries with web search %s',
    async (useWebSearch) => {
      const endpoint = 'https://proxy.example/team/';
      const destinations: string[] = [];
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        destinations.push(String(input));
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer captured-key');
        expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'captured-model' });
        if (destinations.length === 1) {
          return Response.json({ error: { message: 'Rate limited' } }, { status: 429 });
        }
        return useWebSearch
          ? Response.json({ id: 'done', status: 'completed', output: [] })
          : Response.json({
              id: 'done',
              choices: [
                { message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' },
              ],
            });
      });
      const { createAIProvider } = await import('@/lib/providers/ai');
      expect(
        await createAIProvider('openai').generateResponse('', [], {
          endpoint,
          apiKeyOverride: 'captured-key',
          model: 'captured-model',
          skipModeration: true,
          useWebSearch,
        })
      ).toMatchObject({ model: 'captured-model' });
      const expected = `https://proxy.example/team/${useWebSearch ? 'responses' : 'chat/completions'}`;
      expect(destinations).toEqual([expected, expected]);
    }
  );
  it.each([false, true])(
    'does not retry an empty OpenAI length result when its callback fails: %s',
    async (failCallback) => {
      const requests: string[] = [];
      vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
        requests.push(String(input));
        return new Response(
          [
            { choices: [{ delta: {}, finish_reason: 'length' }] },
            { choices: [], usage: { prompt_tokens: 12, completion_tokens: 4 } },
          ]
            .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
            .join('') + 'data: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } }
        );
      });
      const failure = Object.assign(new Error('Usage storage failed'), { status: 503 });
      const { createAIProvider } = await import('@/lib/providers/ai');
      const stream = createAIProvider('openai').streamResponse('', [], {
        model: 'chosen',
        apiKeyOverride: 'request-key',
        skipModeration: true,
        ...(failCallback
          ? {
              onUsage() {
                throw failure;
              },
            }
          : {}),
      });
      const result = await stream.next().catch((error: unknown) => error);
      if (failCallback) expect(result).toBe(failure);
      else
        expect(usageFromGenerationError(result)).toMatchObject({
          inputTokens: 12,
          outputTokens: 4,
        });
      expect(requests).toEqual(['https://api.openai.com/v1/chat/completions']);
    }
  );
  it.each([false, true])(
    'preserves OpenAI reasoning budgets, images and schemas with web search %s',
    async (useWebSearch) => {
      const { getAiProviderMeta } = await import('@/lib/providers/ai-registry');
      const model = getAiProviderMeta('openai').models.find((entry) => entry.isReasoning)?.id;
      if (!model) throw new Error('Missing reasoning model fixture');
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        expect(String(input)).toBe(
          `https://api.openai.com/v1/${useWebSearch ? 'responses' : 'chat/completions'}`
        );
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer request-key');
        expect(body.model).toBe(model);
        expect(body.temperature).toBe(0);
        if (useWebSearch) {
          expect(body).toMatchObject({
            max_output_tokens: 1024,
            tools: [{ type: 'web_search_preview' }],
            text: { format: { name: 'worksheet' } },
            input: [
              { role: 'assistant', content: [{ type: 'input_image', image_url: 'proxy:history' }] },
            ],
          });
          return Response.json({
            id: 'done',
            status: 'completed',
            output: [
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: '{}', annotations: [] }],
              },
            ],
            usage: { input_tokens: 9, output_tokens: 2 },
          });
        }
        expect(body).toMatchObject({
          max_completion_tokens: 16384,
          response_format: { json_schema: { name: 'worksheet' } },
          messages: [
            { role: 'system' },
            {
              role: 'assistant',
              content: [{ type: 'image_url', image_url: { url: 'proxy:history' } }],
            },
          ],
        });
        return Response.json({
          id: 'done',
          choices: [{ message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 9, completion_tokens: 2 },
        });
      });
      const { createAIProvider } = await import('@/lib/providers/ai');
      expect(
        await createAIProvider('openai').generateResponse(
          'system',
          [{ role: 'assistant', content: [{ type: 'image_url', url: 'proxy:history' }] }],
          {
            model,
            apiKeyOverride: 'request-key',
            maxTokens: 1024,
            temperature: 0,
            useWebSearch,
            skipModeration: true,
            jsonSchema: { name: 'worksheet', schema: { type: 'object' } },
          }
        )
      ).toMatchObject({ content: '{}', model, inputTokens: 9, outputTokens: 2 });
    }
  );

  it.each(['', 'partial'])(
    'preserves OpenAI length behavior and measured usage for %s output',
    async (content) => {
      vi.stubGlobal('fetch', async () =>
        Response.json({
          id: 'done',
          choices: [{ message: { role: 'assistant', content }, finish_reason: 'length' }],
          usage: { prompt_tokens: 11, completion_tokens: 4 },
        })
      );
      const { createAIProvider } = await import('@/lib/providers/ai');
      const result = await createAIProvider('openai')
        .generateResponse('', [], {
          model: 'chosen',
          apiKeyOverride: 'request-key',
          skipModeration: true,
        })
        .catch((error: unknown) => error);
      if (content) expect(result).toMatchObject({ content, inputTokens: 11, outputTokens: 4 });
      else {
        expect(result).toBeInstanceOf(Error);
        expect(usageFromGenerationError(result)).toMatchObject({
          inputTokens: 11,
          outputTokens: 4,
        });
      }
    }
  );
  it('does not repeat nonstream generation when its usage callback fails', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return Response.json({
        id: 'done',
        choices: [{ message: { role: 'assistant', content: 'Complete' }, finish_reason: 'stop' }],
      });
    });
    const failure = Object.assign(new Error('Usage storage failed'), { status: 503 });
    const { createAIProvider } = await import('@/lib/providers/ai');
    await expect(
      createAIProvider('groq').generateResponse('', [], {
        model: 'chosen',
        apiKeyOverride: 'selected',
        skipModeration: true,
        onUsage() {
          throw failure;
        },
      })
    ).rejects.toBe(failure);
    expect(requests).toEqual(['https://api.groq.com/openai/v1/chat/completions']);
  });
  it('preserves local endpoint paths, model prefixes and the configured local credential', async () => {
    serverConfiguration.values = {
      aiBaseUrl: 'http://localhost:11434/custom/api',
      aiModel: 'host-model',
    };
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://localhost:11434/custom/api/chat/completions');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer local-secret');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: 'host-model',
        max_completion_tokens: 4096,
      });
      return Response.json({
        id: 'done',
        choices: [
          { message: { role: 'assistant', content: 'Local answer' }, finish_reason: 'stop' },
        ],
      });
    });
    const { createAIProvider } = await import('@/lib/providers/ai');
    expect(
      await createAIProvider('local').generateResponse('', [], {
        model: 'local:host-model',
        apiKeyOverride: ' local-secret ',
        skipModeration: true,
      })
    ).toMatchObject({
      content: 'Local answer',
      model: 'host-model',
      inputTokens: null,
      outputTokens: null,
    });
  });
  it.each([
    ['xai', 'https://api.x.ai/v1/chat/completions'],
    ['deepseek', 'https://api.deepseek.com/v1/chat/completions'],
    ['mistral', 'https://api.mistral.ai/v1/chat/completions'],
    ['groq', 'https://api.groq.com/openai/v1/chat/completions'],
    ['nvidia', 'https://integrate.api.nvidia.com/v1/chat/completions'],
  ])(
    'routes %s through the shared transport without changing its endpoint',
    async (id, endpoint) => {
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe(endpoint);
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer chosen-key');
        expect(JSON.parse(String(init?.body))).toMatchObject({
          model: 'chosen-model',
          max_completion_tokens: 4321,
          temperature: 0,
        });
        return Response.json({
          id: 'done',
          choices: [{ message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 8, completion_tokens: 2 },
        });
      });
      const { createAIProvider } = await import('@/lib/providers/ai');
      expect(
        await createAIProvider(id).generateResponse('system', [], {
          model: 'chosen-model',
          apiKeyOverride: 'chosen-key',
          maxTokens: 4321,
          temperature: 0,
          skipModeration: true,
          useWebSearch: true,
        })
      ).toMatchObject({ content: 'Hello', model: 'chosen-model', inputTokens: 8, outputTokens: 2 });
    }
  );
  it('does not retry successful empty generation when an application callback fails', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return new Response(
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } }
      );
    });
    const failure = Object.assign(new Error('Usage persistence failed'), { status: 503 });
    const stream = streamSharedApiWithRetry('test', selection, '', [], {
      maxTokens: 1,
      onUsage() {
        throw failure;
      },
    });
    await expect(stream.next()).rejects.toBe(failure);
    expect(requests).toEqual(['https://models.example/team/inference/chat/completions']);
  });
  it('uses the shared SDK through the Google factory with its custom endpoint and selected model', async () => {
    const endpoint = 'https://google-proxy.example/team/openai/';
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://google-proxy.example/team/openai/chat/completions');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer request-key');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: 'chosen-google',
        temperature: 0,
        max_completion_tokens: 4096,
      });
      return Response.json({
        id: 'done',
        choices: [{ message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 1 },
      });
    });
    const { createAIProvider } = await import('@/lib/providers/ai');
    expect(
      await createAIProvider('google').generateResponse(
        'system',
        [{ role: 'user', content: 'hello' }],
        {
          model: 'chosen-google',
          apiKeyOverride: 'request-key',
          endpoint,
          skipModeration: true,
          temperature: 0,
        }
      )
    ).toMatchObject({ content: 'Hello', model: 'chosen-google', inputTokens: 3, outputTokens: 1 });
  });
  it('preserves the captured endpoint, image history and generation options', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://models.example/team/inference/chat/completions');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer selected-key');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: 'selected-model',
        max_completion_tokens: 4321,
        temperature: 0,
        messages: [
          { role: 'system', content: 'system' },
          {
            role: 'assistant',
            content: [{ type: 'image_url', image_url: { url: 'proxy:retained-image' } }],
          },
        ],
        response_format: { json_schema: { name: 'worksheet', schema: { type: 'object' } } },
      });
      return Response.json({
        id: 'done',
        model: 'provider-alias',
        choices: [{ message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 9, completion_tokens: 2 },
      });
    });
    const result = await generateSharedApi(
      selection,
      'system',
      [{ role: 'assistant', content: [{ type: 'image_url', url: 'proxy:retained-image' }] }],
      {
        maxTokens: 4321,
        temperature: 0,
        jsonSchema: { name: 'worksheet', schema: { type: 'object' } },
        onUsage(usage) {
          usage.inputTokens = 999;
        },
      }
    );
    expect(result).toMatchObject({
      content: '{}',
      model: 'selected-model',
      inputTokens: 9,
      outputTokens: 2,
      finishReason: 'complete',
    });
  });

  it('keeps unmeasured usage unknown and exposes truncated completion to product policy', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({
        id: 'done',
        choices: [{ message: { role: 'assistant', content: 'partial' }, finish_reason: 'length' }],
      })
    );
    expect(await generateSharedApi(selection, '', [], { maxTokens: 1 })).toMatchObject({
      content: 'partial',
      finishReason: 'length',
      inputTokens: null,
      outputTokens: null,
    });
  });

  it('preserves provider status without silently retrying a failed attempt', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return Response.json({ error: { message: 'Rate limited' } }, { status: 429 });
    });
    await expect(generateSharedApi(selection, '', [], { maxTokens: 1 })).rejects.toMatchObject({
      status: 429,
    });
    expect(requests).toEqual(['https://models.example/team/inference/chat/completions']);
  });

  it('streams measured final usage without letting callbacks mutate retained completion', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          [
            { choices: [{ delta: { content: 'Hello' }, finish_reason: 'stop' }] },
            { choices: [], usage: { prompt_tokens: 7, completion_tokens: 2 } },
          ]
            .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
            .join('') + 'data: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } }
        )
    );
    const chunks: string[] = [];
    let inputTokens: number | null | undefined;
    for await (const chunk of streamSharedApi(selection, '', [], {
      maxTokens: 20,
      onUsage(usage) {
        usage.inputTokens = 999;
      },
      onFinish(finish) {
        inputTokens = finish.usage?.inputTokens;
      },
    }))
      chunks.push(chunk);
    expect(chunks.join('')).toBe('Hello');
    expect(inputTokens).toBe(7);
  });

  it.each(['bridge', 'google', 'openai'])(
    'interrupts a pending body read through the public %s stream',
    async (entrypoint) => {
      let started!: () => void;
      const opened = new Promise<void>((resolve) => {
        started = resolve;
      });
      let stopped = false;
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe(
          entrypoint === 'openai'
            ? 'https://api.openai.com/v1/chat/completions'
            : 'https://models.example/team/inference/chat/completions'
        );
        return new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener(
                'abort',
                () => {
                  stopped = true;
                  controller.error(init.signal?.reason);
                },
                { once: true }
              );
              started();
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } }
        );
      });
      const stream =
        entrypoint === 'bridge'
          ? streamSharedApi(selection, '', [], { maxTokens: 20 })
          : (await import('@/lib/providers/ai'))
              .createAIProvider(entrypoint)
              .streamResponse('', [], {
                maxTokens: 20,
                apiKeyOverride: 'selected-key',
                ...(entrypoint === 'google' ? { endpoint: selection.baseUrl } : {}),
                model: 'selected-model',
                skipModeration: true,
              });
      const pending = stream.next().catch((error: unknown) => error);
      await opened;
      await expect(stream.return(undefined)).resolves.toMatchObject({ done: true });
      expect(await pending).toBeInstanceOf(Error);
      expect(stopped).toBe(true);
    }
  );
});
