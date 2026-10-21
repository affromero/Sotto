// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { learningPreparationRequestFingerprint } from '@/lib/learning/preparation/preparation-provider';

vi.mock('@/lib/prisma', () => ({ prismaUnfiltered: {} }));

describe('complete original document request identity', () => {
  it('replays a native PDF request above four MiB and binds changes at its ending and model selection', async () => {
    const original = Buffer.alloc(3_300_000, 65);
    original.write('%PDF-1.7\n');
    const request = () =>
      new Request('https://provider.invalid/generate', {
        method: 'POST',
        body: JSON.stringify({ document: original.toString('base64') }),
      });
    const selection = { provider: 'fixture', model: 'explicit-model' };
    const signal = new AbortController().signal;
    const first = await learningPreparationRequestFingerprint(request(), selection, signal);
    expect(await learningPreparationRequestFingerprint(request(), selection, signal)).toBe(first);
    original[original.length - 1] = 66;
    expect(await learningPreparationRequestFingerprint(request(), selection, signal)).not.toBe(
      first
    );
    expect(
      await learningPreparationRequestFingerprint(
        request(),
        { ...selection, model: 'changed-model' },
        signal
      )
    ).not.toBe(first);
  });
});
