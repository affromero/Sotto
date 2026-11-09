// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPrerequisiteTokenizer } from '@/lib/classes/help/content/prerequisite-token';

afterEach(() => vi.unstubAllEnvs());

describe('private prerequisite revisions', () => {
  it('uses scoped, domain-separated tokens without exposing source digests', () => {
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'test-only-key');
    const sourceHash = 'a'.repeat(64);
    const snapshotHash = 'b'.repeat(64);
    const one = createPrerequisiteTokenizer('class-1', 'learner-1');
    const same = createPrerequisiteTokenizer('class-1', 'learner-1');
    const otherUser = createPrerequisiteTokenizer('class-1', 'learner-2');
    const otherClass = createPrerequisiteTokenizer('class-2', 'learner-1');
    try {
      const token = one.request({ sourceHash, snapshotHash });
      expect(token.sourceHash).toMatch(/^[a-f0-9]{64}$/);
      expect(token.sourceHash).not.toBe(sourceHash);
      expect(token.snapshotHash).not.toBe(snapshotHash);
      expect(token.sourceHash).toBe(same.source(sourceHash));
      expect(token.sourceHash).not.toBe(otherUser.source(sourceHash));
      expect(token.sourceHash).not.toBe(otherClass.source(sourceHash));
      expect(one.material(sourceHash)).not.toBe(token.sourceHash);
      expect(one.material(sourceHash)).not.toBe(otherUser.material(sourceHash));
      expect(one.material(sourceHash)).not.toBe(otherClass.material(sourceHash));
      expect(one.material(sourceHash)).toBe(same.material(sourceHash));
      expect(one.assessment(sourceHash)).not.toBe(one.material(sourceHash));
      expect(one.assessment(sourceHash)).not.toBe(otherUser.assessment(sourceHash));
      expect(one.assessment(sourceHash)).not.toBe(one.assessment(snapshotHash));
      const help = {
        status: 'AVAILABLE' as const,
        nativeLang: 'en',
        targetLang: 'de',
        canRetry: false,
        request: {
          operationId: '2c157df4-a35d-4e3f-bbd6-670d9b200e2f',
          attempt: 1,
          sourceHash,
          retryOf: '2c157df4-a35d-4e3f-bbd6-670d9b200e2f',
        },
      };
      const publicHelp = one.help(help);
      expect(publicHelp.request.sourceHash).not.toBe(sourceHash);
      expect(publicHelp.request.sourceHash).not.toBe(token.sourceHash);
      expect(publicHelp.request.operationId).not.toBe(help.request.operationId);
      expect(publicHelp.request.operationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
      expect(publicHelp.request.retryOf).toBe(publicHelp.request.operationId);
      expect(one.help(help)).toEqual(same.help(help));
      expect(one.help(help).request).not.toEqual(otherUser.help(help).request);
      expect(one.help(help).request).not.toEqual(otherClass.help(help).request);
      expect(one.request({ sourceHash, snapshotHash: sourceHash }).snapshotHash).not.toBe(
        token.sourceHash
      );
      expect(one.matches(token, { sourceHash, snapshotHash })).toBe(true);
      expect(one.matches({ sourceHash, snapshotHash }, { sourceHash, snapshotHash })).toBe(false);
      expect(
        one.matches({ ...token, snapshotHash: token.sourceHash }, { sourceHash, snapshotHash })
      ).toBe(false);
      expect(one.matchesSource(token.sourceHash, sourceHash)).toBe(true);
      expect(one.matchesSource('invalid', sourceHash)).toBe(false);
    } finally {
      one.dispose();
      same.dispose();
      otherUser.dispose();
      otherClass.dispose();
    }
    expect(() => one.source(sourceHash)).toThrow('Invalid prerequisite revision');
  });

  it('pins the current key for an operation and rejects old tokens after rotation', () => {
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'first-key');
    const first = createPrerequisiteTokenizer('class-1', 'learner-1');
    const raw = { sourceHash: 'a'.repeat(64), snapshotHash: 'b'.repeat(64) };
    const old = first.request(raw);
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'second-key');
    const second = createPrerequisiteTokenizer('class-1', 'learner-1');
    try {
      expect(first.matches(old, raw)).toBe(true);
      expect(second.matches(old, raw)).toBe(false);
      expect(second.matches(second.request(raw), raw)).toBe(true);
      expect(first.material(raw.sourceHash)).not.toBe(second.material(raw.sourceHash));
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  it('fails closed when the instance key is unavailable', () => {
    vi.stubEnv('BYOK_ENCRYPTION_KEY', '');
    expect(() => createPrerequisiteTokenizer('class-1', 'learner-1')).toThrow(
      'BYOK_ENCRYPTION_KEY'
    );
  });
});
