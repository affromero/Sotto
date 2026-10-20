// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import {
  captureSottoCredentialProbe,
  validateSottoCredentialProbe,
} from '@/lib/providers/shared/credential-validation';
import { CARTESIA_TTS_API_VERSION } from '@/lib/providers/shared/speech-contracts';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([
  {
    provider: 'together',
    status: 'inconclusive',
    url: 'https://api.together.xyz/v1/models',
    authorization: 'Bearer personal-key',
    body: { object: 'list', data: [] },
  },
  {
    provider: 'deepgram',
    status: 'valid',
    url: 'https://api.deepgram.com/v1/projects',
    authorization: 'Token personal-key',
    body: { projects: [] },
  },
  {
    provider: 'assemblyai',
    status: 'valid',
    url: 'https://api.assemblyai.com/v2/transcript?limit=1',
    authorization: 'personal-key',
    body: { transcripts: [], page_details: { limit: 1, result_count: 0 } },
  },
])(
  'reports $status for $provider using its captured endpoint and authentication scheme',
  async ({ provider, status, url, authorization, body }) => {
    let observed: { url: string; authorization: string | null } | undefined;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, options?: RequestInit) => {
      const request = new Request(input, options);
      observed = { url: request.url, authorization: request.headers.get('authorization') };
      return Response.json(body);
    });
    expect(
      await validateSottoCredentialProbe(
        captureSottoCredentialProbe('ai', provider, { apiKey: 'personal-key' })
      )
    ).toMatchObject({ status });
    expect(observed).toEqual({ url, authorization });
  }
);

it('requires a personal PlayHT user ID without borrowing the platform account', async () => {
  vi.stubEnv('PLAYHT_USER_ID', 'platform-account');
  vi.stubGlobal('fetch', () => {
    throw new Error('Incomplete credentials must not reach the provider');
  });
  expect(
    await validateSottoCredentialProbe(
      captureSottoCredentialProbe('tts', 'playht', { apiKey: 'personal-key' })
    )
  ).toMatchObject({ status: 'missing' });
});

it('verifies the captured PlayHT key and user ID together', async () => {
  const values = { apiKey: 'personal-key', userId: 'personal-account' };
  const probe = captureSottoCredentialProbe('tts', 'playht', values);
  values.apiKey = 'later-key';
  values.userId = 'later-account';
  let observed: { url: string; key: string | null; account: string | null } | undefined;
  vi.stubGlobal('fetch', async (url: URL, options: RequestInit) => {
    const headers = new Headers(options.headers);
    observed = {
      url: url.href,
      key: headers.get('authorization'),
      account: headers.get('x-user-id'),
    };
    return Response.json([]);
  });
  expect(await validateSottoCredentialProbe(probe)).toMatchObject({ status: 'valid' });
  expect(observed).toEqual({
    url: 'https://api.play.ht/api/v2/cloned-voices',
    key: 'personal-key',
    account: 'personal-account',
  });
});

it('uses the speech generation contract version for Cartesia validation', async () => {
  let version: string | null = null;
  vi.stubGlobal('fetch', async (url: URL, options: RequestInit) => {
    expect(url.origin).toBe('https://api.cartesia.ai');
    version = new Headers(options.headers).get('cartesia-version');
    return Response.json({ data: [], has_more: false });
  });
  expect(
    await validateSottoCredentialProbe(
      captureSottoCredentialProbe('tts', 'cartesia', { apiKey: 'personal-key' })
    )
  ).toMatchObject({ status: 'valid' });
  expect(version).toBe(CARTESIA_TTS_API_VERSION);
});

it('retains FAL as the explicit MiniMax credential authority', async () => {
  let endpoint: string | undefined;
  vi.stubGlobal('fetch', async (url: URL) => {
    endpoint = url.origin;
    return Response.json({
      prices: [{ endpoint_id: 'fal-ai/flux/dev', unit_price: 1, unit: 'image', currency: 'USD' }],
      has_more: false,
      next_cursor: null,
    });
  });
  expect(
    await validateSottoCredentialProbe(
      captureSottoCredentialProbe('tts', 'minimax', { apiKey: 'fal-key' })
    )
  ).toMatchObject({ status: 'valid' });
  expect(endpoint).toBe('https://api.fal.ai');
});

it.each([
  [401, 'rejected'],
  [403, 'inconclusive'],
  [429, 'inconclusive'],
  [503, 'inconclusive'],
] as const)(
  'reports HTTP %s without confusing an outage with rejection',
  async (status, expected) => {
    vi.stubGlobal('fetch', async () => new Response(null, { status }));
    expect(
      await validateSottoCredentialProbe(
        captureSottoCredentialProbe('visual', 'pexels', { apiKey: 'personal-key' })
      )
    ).toMatchObject({ status: expected });
  }
);

it('does not certify credentials from a malformed success response', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ success: true }));
  expect(
    await validateSottoCredentialProbe(
      captureSottoCredentialProbe('visual', 'pexels', { apiKey: 'personal-key' })
    )
  ).toMatchObject({ status: 'inconclusive' });
});

it('preserves caller cancellation instead of offering an unverified save', async () => {
  const controller = new AbortController();
  controller.abort(new Error('Caller cancelled'));
  await expect(
    validateSottoCredentialProbe(
      captureSottoCredentialProbe('visual', 'pexels', { apiKey: 'personal-key' }),
      controller.signal
    )
  ).rejects.toThrow('Caller cancelled');
});
