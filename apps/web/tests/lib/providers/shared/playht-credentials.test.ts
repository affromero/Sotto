// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PlayHtProvider } from '@/lib/providers/tts/playht.provider';
import { createProviderTransport } from 'thesidedoor-core/providers/transport';

function transport() {
  return createProviderTransport({
    rules: [{ method: 'POST', url: PlayHtProvider.speechEndpoint }],
    admit: async () => {},
  });
}

beforeEach(() => {
  vi.stubEnv('PLAYHT_API_KEY', 'platform-key');
  vi.stubEnv('PLAYHT_USER_ID', 'platform-account');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each(['personal', 'platform'] as const)(
  'sends the complete captured %s account and explicit model',
  async (source) => {
    let observed: { key: string | null; account: string | null; model: string } | undefined;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, options?: RequestInit) => {
      const request = new Request(input, options);
      expect(request.url).toBe('https://api.play.ht/api/v2/tts/stream');
      const body = (await request.json()) as { voice_engine: string };
      observed = {
        key: request.headers.get('authorization'),
        account: request.headers.get('x-user-id'),
        model: body.voice_engine,
      };
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const provider = new PlayHtProvider(
      { apiKey: `${source}-key`, userId: `${source}-account` },
      transport(),
      'Play3.0-mini'
    );
    vi.stubEnv('PLAYHT_API_KEY', 'later-key');
    vi.stubEnv('PLAYHT_USER_ID', 'later-account');
    expect(await provider.generateSpeech({ text: 'Hello', voiceId: 'voice' })).toEqual(
      Buffer.from([1, 2, 3])
    );
    expect(observed).toEqual({
      key: `${source}-key`,
      account: `${source}-account`,
      model: 'Play3.0-mini',
    });
  }
);

it.each([
  { apiKey: 'personal-key', userId: '' },
  { apiKey: '', userId: 'personal-account' },
  { apiKey: 'personal-key', userId: '  ' },
])(
  'rejects incomplete explicit credentials without borrowing platform fields: $apiKey, $userId',
  (credentials) => {
    vi.stubGlobal('fetch', () => {
      throw new Error('Incomplete credentials reached HTTP');
    });
    expect(() => new PlayHtProvider(credentials, transport())).toThrow('same account');
  }
);
