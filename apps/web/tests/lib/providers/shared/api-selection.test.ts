// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createSelectedApiRegistry } from 'thesidedoor-core/ai/providers';
import { captureApiEndpoint, selectedApi } from '@/lib/providers/shared/api-selection';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each(['anthropic', 'openai', 'google'])(
  'does not dispatch with empty saved %s credentials',
  async (provider) => {
    const requests: unknown[] = [];
    vi.stubGlobal('fetch', async (...args: unknown[]) => {
      requests.push(args);
      return Response.json({ data: [] });
    });
    const registry = createSelectedApiRegistry(
      selectedApi({
        provider,
        label: provider,
        transport: provider === 'anthropic' ? 'anthropic' : 'compatible',
        apiKey: '',
        endpoint: captureApiEndpoint(provider),
      })
    );
    expect((await registry.validateCredentials(provider)).status).toBe('missing');
    expect(requests).toEqual([]);
  }
);

it.each([
  ['google', 'compatible', 'https://generativelanguage.googleapis.com/v1beta/openai/models'],
  ['openai', 'compatible', 'https://api.openai.com/v1/models'],
  ['openai', 'responses', 'https://api.openai.com/v1/models'],
  ['anthropic', 'anthropic', 'https://api.anthropic.com/v1/models?limit=1'],
] as const)(
  'uses the canonical captured %s endpoint with %s validation',
  async (provider, transport, expectedEndpoint) => {
    const selected = selectedApi({
      provider,
      label: provider,
      transport,
      apiKey: 'personal-key',
      endpoint: captureApiEndpoint(provider),
    });
    const requests: Array<{ endpoint: string; key: string | null }> = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      requests.push({
        endpoint: String(input),
        key: headers.get(provider === 'anthropic' ? 'x-api-key' : 'authorization'),
      });
      return Response.json({ data: [], has_more: false, first_id: null, last_id: null });
    });
    expect(await createSelectedApiRegistry(selected).validateCredentials(provider)).toMatchObject({
      status: provider === 'anthropic' ? 'valid' : 'inconclusive',
      readiness: { code: 'ready' },
    });
    expect(requests).toEqual([
      {
        endpoint: expectedEndpoint,
        key: provider === 'anthropic' ? 'personal-key' : 'Bearer personal-key',
      },
    ]);
  }
);
