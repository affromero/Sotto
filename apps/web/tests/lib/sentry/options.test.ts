// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type Envelope = [unknown, Array<[{ type: string }, Record<string, unknown>]>];
function capture(useDefaults = false) {
  const markers = Object.fromEntries(
    ['cookie', 'body', 'query', 'header', 'aiInput', 'aiOutput'].map((key) => [
      key,
      `${key}-${randomUUID()}`,
    ])
  );
  const fixture = fileURLToPath(new URL('../../fixtures/sentry-private-data.ts', import.meta.url));
  const args = ['--import', 'tsx', fixture, JSON.stringify(markers)];
  if (useDefaults) args.push('--sdk-defaults');
  const output = execFileSync(process.execPath, args, { encoding: 'utf8', timeout: 20000 });
  const envelopes = JSON.parse(output) as Envelope[];
  return { markers, envelopes, items: envelopes.flatMap((envelope) => envelope[1]) };
}

describe('Sentry dependency compatibility', () => {
  it('delivers errors and AI traces without collecting protected lesson data', () => {
    const { markers, envelopes, items } = capture();
    expect(
      items.some(
        ([header, event]) =>
          header.type === 'event' && JSON.stringify(event).includes('Synthetic lesson failure')
      )
    ).toBe(true);
    const transactions = items.filter(([header]) => header.type === 'transaction');
    expect(transactions.length).toBeGreaterThan(0);
    const aiSpans = items.filter(([header]) => header.type === 'span');
    expect(JSON.stringify(aiSpans)).toContain('gen_ai.operation.name');
    expect(JSON.stringify(aiSpans)).toContain('synthetic-model');
    expect(JSON.stringify(aiSpans)).toContain('gen_ai.usage.output_tokens');
    const serialized = JSON.stringify(envelopes);
    for (const marker of Object.values(markers)) expect(serialized).not.toContain(marker);
    expect(serialized).toContain('skill=grammar');
    for (const [header, event] of items) {
      if (header.type !== 'event') continue;
      expect(event).not.toHaveProperty('user.ip_address');
    }
  }, 25000);

  it('detects the broader collection in the unconfigured SDK', () => {
    const { markers, envelopes, items } = capture(true);
    const serialized = JSON.stringify(envelopes);
    for (const marker of Object.values(markers)) expect(serialized).toContain(marker);
    expect(
      items.some(([header, event]) => header.type === 'event' && Object.hasOwn(event, 'user'))
    ).toBe(true);
  }, 25000);
});
