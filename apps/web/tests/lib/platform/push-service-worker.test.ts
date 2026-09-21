// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

describe('service worker push display', () => {
  it('replaces a replayed notification while keeping different notifications separate', async () => {
    type Event = { data: { json: () => unknown }; waitUntil: (work: Promise<void>) => void };
    const listeners = new Map<string, (event: Event) => void>();
    const cards = new Map<string, { body: string; renotify: boolean }>();
    const alerts: string[] = [];
    runInNewContext(await readFile('public/sw.js', 'utf8'), {
      self: {
        addEventListener: (name: string, listener: (event: Event) => void) =>
          listeners.set(name, listener),
        registration: {
          showNotification: async (
            title: string,
            options: { tag: string; body: string; renotify: boolean }
          ) => {
            if (!cards.has(options.tag) || options.renotify) alerts.push(title);
            cards.set(options.tag, options);
          },
        },
      },
    });
    async function push(notificationId: string, body: string) {
      let pending = Promise.resolve();
      listeners.get('push')!({
        data: { json: () => ({ notificationId, title: body, body }) },
        waitUntil: (work) => {
          pending = work;
        },
      });
      await pending;
    }
    await push('first', 'First lesson');
    await push('first', 'First lesson');
    await push('second', 'Second lesson');
    expect([...cards.keys()]).toEqual(['first', 'second']);
    expect(alerts).toEqual(['First lesson', 'Second lesson']);
  });
});
