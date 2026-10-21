// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { SottoClient } from '../../../../../packages/mcp/src/client';
import { createServer } from '../../../../../packages/mcp/src/server';

const requestId = '72ebd105-a15a-42d5-8620-fdd986287b40';
const selection = { catalogVersion: 1, nodeIds: ['de.grammar.past.perfekt'], level: 'A2' };
const open: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  for (const item of open.splice(0)) await item.close();
  vi.unstubAllGlobals();
});
async function connect() {
  const server = createServer(new SottoClient('sk_sotto_owned', 'http://localhost:3000'));
  const client = new Client({ name: 'learner-test', version: '1' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  open.push(client, server);
  return client;
}
function response(body: unknown, status = 200) {
  return Response.json(body, { status });
}
describe('learning tools use canonical owned HTTP operations', () => {
  it('browses a lower level and paginates source focuses with bearer authentication', async () => {
    const requests: Array<{ url: string; options: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, options: RequestInit) => {
        requests.push({ url, options });
        return response({ currentLevel: 'A2', viewedLevel: 'A1', ready: false });
      })
    );
    const client = await connect();
    const result = await client.callTool({
      name: 'get_learning_map',
      arguments: { course_id: 'owned/course', level: 'A1' },
    });
    expect(result.isError).not.toBe(true);
    await client.callTool({
      name: 'list_source_focuses',
      arguments: { analysis_id: requestId, after_order: 19 },
    });
    expect(requests.map((item) => item.url)).toEqual([
      'http://localhost:3000/api/v1/courses/owned%2Fcourse/learning-map/levels/A1',
      `http://localhost:3000/api/v1/material-analyses/${requestId}?afterOrder=19`,
    ]);
    expect(requests.every((item) => item.options.method === 'GET' && !item.options.body)).toBe(
      true
    );
    for (const request of requests)
      expect(new Headers(request.options.headers).get('Authorization')).toBe(
        'Bearer sk_sotto_owned'
      );
  });
  it('previews without generation, then preserves exact practice admission on a lost response', async () => {
    const bodies: unknown[] = [];
    const paths: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, options: RequestInit) => {
        paths.push(url);
        bodies.push(JSON.parse(String(options.body)));
        if (paths.length === 2) throw new Error('Response lost');
        return response(
          paths.length === 1
            ? { selection, availableKinds: ['GRAMMAR'] }
            : { status: 'PREPARING', sessionId: 'same-session' }
        );
      })
    );
    const client = await connect();
    await client.callTool({
      name: 'preview_focused_practice',
      arguments: { course_id: 'c1', selection },
    });
    const args = { course_id: 'c1', request_id: requestId, kind: 'GRAMMAR', selection };
    const lost = await client.callTool({ name: 'start_focused_practice', arguments: args });
    expect(lost.isError).toBe(true);
    const retry = await client.callTool({ name: 'start_focused_practice', arguments: args });
    expect(retry.isError).not.toBe(true);
    expect(paths).toEqual([
      'http://localhost:3000/api/v1/courses/c1/learning-map/selection',
      'http://localhost:3000/api/v1/courses/c1/practice',
      'http://localhost:3000/api/v1/courses/c1/practice',
    ]);
    expect(bodies).toEqual([
      selection,
      { requestId, kind: 'GRAMMAR', learningSelection: selection },
      { requestId, kind: 'GRAMMAR', learningSelection: selection },
    ]);
  });
  it('preserves a server advancement refusal and never substitutes a level mutation', async () => {
    let submitted: unknown;
    const fetch = vi.fn(async (_url: string, options: RequestInit) => {
      submitted = JSON.parse(String(options.body));
      return response({ error: 'Required objectives remain unassessed.' }, 409);
    });
    vi.stubGlobal('fetch', fetch);
    const client = await connect();
    const result = await client.callTool({
      name: 'advance_learning_level',
      arguments: {
        course_id: 'c1',
        request_id: requestId,
        expected_level: 'A2',
        catalog_hash: 'a'.repeat(64),
      },
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: 'Required objectives remain unassessed.' },
    ]);
    expect(submitted).toEqual({ requestId, expectedLevel: 'A2', catalogHash: 'a'.repeat(64) });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
