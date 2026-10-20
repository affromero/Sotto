import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

export async function nativeControl(configuration) {
  const events = [];
  const run = randomUUID();
  let config = { ...configuration, run };
  let peer;
  let closed = false;
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.url, `/${run}`);
      if (request.method === 'POST') {
        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          assert.ok(size <= 8192);
          chunks.push(chunk);
        }
        const event = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        assert.ok(['invitation', 'joined', 'round', 'completed', 'done'].includes(event.type));
        if (event.type === 'round') {
          assert.ok(Number.isInteger(event.round) && event.round >= 0 && event.round < 6);
          peer?.configure({ partnerRound: event.round });
        }
        if (event.type === 'invitation') {
          const link = new URL(event.invitation);
          assert.equal(link.origin, new URL(config.server).origin);
          assert.equal(link.pathname, '/play/join');
          assert.match(link.searchParams.get('code') || '', /^[A-Z0-9]{12}$/);
          config = { ...config, invitation: event.invitation };
        }
        events.push(event);
      } else assert.equal(request.method, 'GET');
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(config));
    } catch (error) {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/${run}`,
    events,
    link(other) {
      peer = other;
    },
    configure(values) {
      config = { ...config, ...values };
    },
    async wait(type, timeout = 180_000) {
      const end = Date.now() + timeout;
      while (!closed && Date.now() < end) {
        const event = events.find((event) => event.type === type);
        if (event) return event;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`Native ${configuration.role} did not report ${type} before the deadline.`);
    },
    close() {
      closed = true;
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
