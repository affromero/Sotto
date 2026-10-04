import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import * as Sentry from '@sentry/node';
import { sentryCompatibilityOptions } from '../../src/lib/sentry/options';

async function main() {
  const envelopes: unknown[] = [];
  const markers = JSON.parse(process.argv[2]) as Record<string, string>;
  const client = Sentry.init({
    ...(process.argv.includes('--sdk-defaults') ? {} : sentryCompatibilityOptions),
    dsn: 'https://public@example.test/1',
    tracesSampleRate: 1,
    transport: () => ({
      send: async (envelope) => {
        envelopes.push(envelope);
        return { statusCode: 200 };
      },
      flush: async () => true,
    }),
  });
  assert(client);

  const { createServer } = await import('node:http');
  const { default: OpenAI } = await import('openai');
  let ai: InstanceType<typeof OpenAI>;
  const responsesClosed: Promise<void>[] = [];
  const server = createServer(async (request, response) => {
    responsesClosed.push(new Promise<void>((resolve) => response.once('close', resolve)));
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      request.once('end', resolve);
      request.once('error', reject);
    });
    const body = Buffer.concat(chunks).toString();
    if (request.url === '/v1/chat/completions') {
      assert(body.includes(markers.aiInput));
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          id: 'synthetic-completion',
          object: 'chat.completion',
          created: 1,
          model: 'synthetic-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: markers.aiOutput },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })
      );
      return;
    }
    assert(body.includes(markers.body));
    await ai.chat.completions.create({
      model: 'synthetic-model',
      messages: [{ role: 'user', content: markers.aiInput }],
    });
    Sentry.captureException(new Error('Synthetic lesson failure'));
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ai = Sentry.instrumentOpenAiClient(
    new OpenAI({ apiKey: 'synthetic-test-key', baseURL: `${base}/v1`, maxRetries: 0 })
  );
  try {
    await Sentry.startSpan(
      { name: 'Synthetic lesson request', forceTransaction: true },
      async () => {
        const response = await fetch(`${base}/lesson?remote-user=${markers.query}&skill=grammar`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `progress=${markers.cookie}`,
            'X-Forwarded-For': markers.header,
          },
          body: JSON.stringify({ lesson: markers.body }),
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ok: true });
        await Promise.all(responsesClosed);
      }
    );
    await Sentry.startSpan(
      { name: 'Synthetic worker lesson', forceTransaction: true },
      async () => {
        await ai.chat.completions.create({
          model: 'synthetic-model',
          messages: [{ role: 'user', content: markers.aiInput }],
        });
      }
    );
    await Promise.all(responsesClosed);
    assert(await client.flush(5000));
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    assert(await client.close(5000));
  }
  process.stdout.write(JSON.stringify(envelopes));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
