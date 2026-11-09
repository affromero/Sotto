import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decodeAssessmentHistory,
  encodeAssessmentHistory,
} from '@/lib/learning/classes/history/assessment-history-codec';

describe('assessment history pages', () => {
  it('restores private content across a multibyte page boundary', () => {
    const value = { task: 'п'.repeat(270_000), answer: 'чай', threshold: 0.7 };
    const saved = encodeAssessmentHistory(value);
    expect(saved.chunks.length).toBeGreaterThan(1);
    expect(decodeAssessmentHistory(saved.manifest, saved.chunks)).toEqual(value);
  });

  it('rejects missing, reordered, altered, or noncanonical pages', () => {
    const saved = encodeAssessmentHistory({ content: 'x'.repeat(600_000) });
    expect(() => decodeAssessmentHistory(saved.manifest, saved.chunks.slice(1))).toThrow();
    expect(() => decodeAssessmentHistory(saved.manifest, [...saved.chunks].reverse())).toThrow();
    const altered = saved.chunks.map((chunk, index) =>
      index ? chunk : { ...chunk, data: `A${chunk.data.slice(1)}` }
    );
    expect(() => decodeAssessmentHistory(saved.manifest, altered)).toThrow();
    const invalid = saved.chunks.map((chunk, index) =>
      index ? chunk : { ...chunk, data: `!${chunk.data.slice(1)}` }
    );
    expect(() => decodeAssessmentHistory(saved.manifest, invalid)).toThrow();
    expect(() =>
      decodeAssessmentHistory({ ...saved.manifest, bytes: saved.manifest.bytes + 1 }, saved.chunks)
    ).toThrow();
  });

  it('rejects invalid UTF-8 even when its digest is correct', () => {
    const bytes = Buffer.from([0xff]);
    expect(() =>
      decodeAssessmentHistory(
        {
          version: 1,
          digest: createHash('sha256').update(bytes).digest('hex'),
          bytes: 1,
          chunks: 1,
        },
        [{ version: 1, index: 0, data: bytes.toString('base64') }]
      )
    ).toThrow();
  });

  it('rejects content beyond the retention limit', () => {
    expect(() => encodeAssessmentHistory('x'.repeat(32 * 1024 * 1024))).toThrow(/size limit/);
  });
});
