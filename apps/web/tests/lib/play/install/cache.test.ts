// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

describe('installed game privacy', () => {
  it('leaves invitations, authenticated games, proof recovery and notebook responses on the network', async () => {
    type FetchEvent = {
      request: { url: string; method: string; mode: string };
      respondWith: (response: unknown) => void;
    };
    const handlers = new Map<string, (event: FetchEvent) => void>();
    const intercepted: unknown[] = [];
    runInNewContext(await readFile('public/sw.js', 'utf8'), {
      URL,
      self: {
        location: { origin: 'https://sotto.example' },
        addEventListener: (name: string, handler: (event: FetchEvent) => void) =>
          handlers.set(name, handler),
      },
      caches: {
        match: () => {
          throw new Error('Private game traffic must not read a cache');
        },
      },
    });
    for (const [method, path, mode] of [
      ['GET', '/play/join?v=1&code=ABCDEFGH2345', 'navigate'],
      ['GET', '/play/rooms/private', 'navigate'],
      ['GET', '/api/v1/play/rooms/private', 'cors'],
      ['POST', '/api/v1/play/join-requests/private/claim', 'cors'],
      ['GET', '/api/v1/play/join-requests/private', 'cors'],
      ['GET', '/api/v1/play/phrases', 'cors'],
    ])
      handlers.get('fetch')!({
        request: { url: `https://sotto.example${path}`, method, mode },
        respondWith: (response) => intercepted.push(response),
      });
    expect(intercepted).toEqual([]);
  });
});
