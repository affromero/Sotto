import { describe, it, expect } from 'vitest';
import {
  scoreToneMatch,
  scoreVoice,
  selectVoicePair,
  VOICE_POOL,
  type VoiceMatchMetadata,
} from '@/lib/voice-pool';

describe('scoreToneMatch', () => {
  it('boosts casual keywords in character string', () => {
    const score = scoreToneMatch('casual and curious', 'casual');
    expect(score).toBeGreaterThan(0);
  });

  it('penalizes authoritative voices for casual tone', () => {
    const score = scoreToneMatch('authoritative expert', 'casual');
    expect(score).toBeLessThan(0);
  });

  it('boosts polished professional for professional tone', () => {
    const score = scoreToneMatch('polished professional', 'professional');
    expect(score).toBeGreaterThan(0);
  });

  it('penalizes casual voices for professional tone', () => {
    const score = scoreToneMatch('casual and curious', 'professional');
    expect(score).toBeLessThan(0);
  });

  it('boosts distinguished professor for socratic tone', () => {
    const score = scoreToneMatch('distinguished professor', 'socratic');
    expect(score).toBeGreaterThan(0);
  });

  it('returns 0 for no keyword matches', () => {
    const score = scoreToneMatch('warm narrator', 'socratic');
    expect(score).toBe(0);
  });
});

describe('scoreVoice', () => {
  it('stacks tone and audienceLevel scores', () => {
    // Charlie: young, "casual and curious"
    const charlie = VOICE_POOL.find((v) => v.name === 'Charlie')!;
    const metadata: VoiceMatchMetadata = { tone: 'casual', audienceLevel: 'beginner' };
    const score = scoreVoice(charlie, metadata);
    // casual + curious = +6 from tone, young + beginner = +2 from audience level
    expect(score).toBe(8);
  });

  it('stacks tone, audienceLevel, and audience scores', () => {
    const charlie = VOICE_POOL.find((v) => v.name === 'Charlie')!;
    const metadata: VoiceMatchMetadata = {
      tone: 'casual',
      audienceLevel: 'beginner',
      audience: 'teens',
    };
    const score = scoreVoice(charlie, metadata);
    // tone: +6, audienceLevel(beginner+young): +2, audience(teens+young): +1
    expect(score).toBe(9);
  });

  it('penalizes mismatched combinations', () => {
    // George: mature, "distinguished professor"
    const george = VOICE_POOL.find((v) => v.name === 'George')!;
    const metadata: VoiceMatchMetadata = {
      tone: 'casual',
      audienceLevel: 'beginner',
      audience: 'kids',
    };
    const score = scoreVoice(george, metadata);
    // tone: "distinguished" penalty -2, audienceLevel(beginner+mature): -1, audience(kids+mature): -1
    expect(score).toBe(-4);
  });

  it('returns 0 for empty metadata', () => {
    const adam = VOICE_POOL.find((v) => v.name === 'Adam')!;
    const score = scoreVoice(adam, {});
    expect(score).toBe(0);
  });

  it('handles partial metadata (tone only)', () => {
    const charlotte = VOICE_POOL.find((v) => v.name === 'Charlotte')!;
    const score = scoreVoice(charlotte, { tone: 'professional' });
    // "polished professional" → polished(+3) + professional(+3) = +6
    expect(score).toBe(6);
  });
});

describe('selectVoicePair backward compatibility', () => {
  it('returns same result without metadata as original hash-based logic', () => {
    const testIds = ['episode-abc-123', 'test-xyz-456', 'another-episode-789'];
    for (const id of testIds) {
      const withoutMeta = selectVoicePair(id);
      const withEmptyMeta = selectVoicePair(id, {});
      expect(withoutMeta.host.name).toBe(withEmptyMeta.host.name);
      expect(withoutMeta.expert.name).toBe(withEmptyMeta.expert.name);
    }
  });

  it('returns same result with undefined metadata', () => {
    const result1 = selectVoicePair('test-episode-id');
    const result2 = selectVoicePair('test-episode-id', undefined);
    expect(result1.host.name).toBe(result2.host.name);
    expect(result1.expert.name).toBe(result2.expert.name);
  });
});

describe('selectVoicePair with metadata', () => {
  it('is deterministic (same inputs produce same output)', () => {
    const metadata: VoiceMatchMetadata = { tone: 'casual', audienceLevel: 'beginner' };
    const result1 = selectVoicePair('test-episode-id', metadata);
    const result2 = selectVoicePair('test-episode-id', metadata);
    expect(result1.host.name).toBe(result2.host.name);
    expect(result1.expert.name).toBe(result2.expert.name);
  });

  it('different metadata can produce different pairs', () => {
    const episodeId = 'same-episode-for-comparison';
    const casual = selectVoicePair(episodeId, { tone: 'casual' });
    const socratic = selectVoicePair(episodeId, { tone: 'socratic' });
    // The tiers are different so at least one voice should differ (host or expert)
    const samePair =
      casual.host.name === socratic.host.name && casual.expert.name === socratic.expert.name;
    expect(samePair).toBe(false);
  });

  it('always preserves gender contrast between host and expert', () => {
    const tones: VoiceMatchMetadata['tone'][] = ['casual', 'professional', 'socratic'];
    const levels: VoiceMatchMetadata['audienceLevel'][] = ['beginner', 'intermediate', 'expert'];

    for (const tone of tones) {
      for (const level of levels) {
        for (let i = 0; i < 20; i++) {
          const result = selectVoicePair(`gender-test-${tone}-${level}-${i}`, {
            tone,
            audienceLevel: level,
          });
          expect(result.host.gender).not.toBe(result.expert.gender);
        }
      }
    }
  });
});

describe('tier diversity', () => {
  it('produces multiple distinct hosts across episode IDs with same metadata', () => {
    const metadata: VoiceMatchMetadata = { tone: 'casual' };
    const hosts = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const result = selectVoicePair(`diversity-test-${i}`, metadata);
      hosts.add(result.host.name);
    }
    expect(hosts.size).toBeGreaterThanOrEqual(3);
  });

  it('produces multiple distinct hosts for professional metadata', () => {
    const metadata: VoiceMatchMetadata = { tone: 'professional' };
    const hosts = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const result = selectVoicePair(`prof-diversity-${i}`, metadata);
      hosts.add(result.host.name);
    }
    expect(hosts.size).toBeGreaterThanOrEqual(3);
  });
});

describe('edge cases', () => {
  it('handles empty metadata object', () => {
    const result = selectVoicePair('edge-case-empty', {});
    expect(result.host).toBeDefined();
    expect(result.expert).toBeDefined();
    expect(result.host.name).not.toBe(result.expert.name);
  });

  it('handles metadata with only tone', () => {
    const result = selectVoicePair('edge-case-tone-only', { tone: 'casual' });
    expect(result.host).toBeDefined();
    expect(result.expert).toBeDefined();
  });

  it('handles metadata with only audienceLevel', () => {
    const result = selectVoicePair('edge-case-level-only', { audienceLevel: 'expert' });
    expect(result.host).toBeDefined();
    expect(result.expert).toBeDefined();
  });

  it('handles all three fields set', () => {
    const result = selectVoicePair('edge-case-all-fields', {
      tone: 'socratic',
      audienceLevel: 'expert',
      audience: 'mature',
    });
    expect(result.host).toBeDefined();
    expect(result.expert).toBeDefined();
    expect(result.host.gender).not.toBe(result.expert.gender);
  });

  it('host and expert are never the same voice', () => {
    for (let i = 0; i < 50; i++) {
      const result = selectVoicePair(`uniqueness-${i}`, { tone: 'casual' });
      expect(result.host.name).not.toBe(result.expert.name);
    }
  });
});
