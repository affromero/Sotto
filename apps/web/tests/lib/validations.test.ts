import { describe, it, expect } from 'vitest';
import {
  discoveryMessageSchema,
  createEpisodeSchema,
  interactionSchema,
  updateEpisodeSchema,
  configureAvatarsSchema,
  updateAvatarPositionsSchema,
  regenerateWithFeedbackSchema,
} from '@/lib/validations';

describe('discoveryMessageSchema', () => {
  it('accepts valid content', () => {
    const result = discoveryMessageSchema.safeParse({ content: 'Tell me about quantum physics' });
    expect(result.success).toBe(true);
  });

  it('accepts content with optional episodeId', () => {
    const result = discoveryMessageSchema.safeParse({
      content: 'Tell me more',
      episodeId: 'abc-123',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.episodeId).toBe('abc-123');
    }
  });

  it('accepts content without episodeId', () => {
    const result = discoveryMessageSchema.safeParse({ content: 'Hello' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.episodeId).toBeUndefined();
    }
  });

  it('rejects empty content', () => {
    const result = discoveryMessageSchema.safeParse({ content: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing content', () => {
    const result = discoveryMessageSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects content exceeding 5000 characters', () => {
    const result = discoveryMessageSchema.safeParse({ content: 'a'.repeat(5001) });
    expect(result.success).toBe(false);
  });

  it('accepts content at exactly 5000 characters', () => {
    const result = discoveryMessageSchema.safeParse({ content: 'a'.repeat(5000) });
    expect(result.success).toBe(true);
  });

  it('accepts single character content', () => {
    const result = discoveryMessageSchema.safeParse({ content: 'x' });
    expect(result.success).toBe(true);
  });

  it('rejects non-string content', () => {
    const result = discoveryMessageSchema.safeParse({ content: 123 });
    expect(result.success).toBe(false);
  });
});

describe('createEpisodeSchema', () => {
  it('accepts valid input', () => {
    const result = createEpisodeSchema.safeParse({
      title: 'Quantum Physics 101',
      topic: 'An introduction to quantum mechanics for beginners',
      discoveryId: 'disc-123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty title', () => {
    const result = createEpisodeSchema.safeParse({
      title: '',
      topic: 'Some topic',
      discoveryId: 'disc-123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects title exceeding 200 characters', () => {
    const result = createEpisodeSchema.safeParse({
      title: 'a'.repeat(201),
      topic: 'Some topic',
      discoveryId: 'disc-123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty topic', () => {
    const result = createEpisodeSchema.safeParse({
      title: 'My Episode',
      topic: '',
      discoveryId: 'disc-123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects topic exceeding 5000 characters', () => {
    const result = createEpisodeSchema.safeParse({
      title: 'My Episode',
      topic: 'a'.repeat(5001),
      discoveryId: 'disc-123',
    });
    expect(result.success).toBe(false);
  });

  it('accepts missing discoveryId (optional for Twitter/API sources)', () => {
    const result = createEpisodeSchema.safeParse({
      title: 'My Episode',
      topic: 'A topic',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing title', () => {
    const result = createEpisodeSchema.safeParse({
      topic: 'A topic',
      discoveryId: 'disc-123',
    });
    expect(result.success).toBe(false);
  });

  it('accepts title at exactly 200 characters', () => {
    const result = createEpisodeSchema.safeParse({
      title: 'a'.repeat(200),
      topic: 'A topic',
      discoveryId: 'disc-123',
    });
    expect(result.success).toBe(true);
  });

  it('accepts durationTarget within valid range', () => {
    const result = createEpisodeSchema.safeParse({
      title: 'My Episode',
      topic: 'A topic',
      metadata: { topic: 'A topic', durationTarget: 20 },
    });
    expect(result.success).toBe(true);
  });

  it('accepts durationTarget at minimum boundary (1)', () => {
    const result = createEpisodeSchema.safeParse({
      title: 'My Episode',
      topic: 'A topic',
      metadata: { topic: 'A topic', durationTarget: 1 },
    });
    expect(result.success).toBe(true);
  });

  it('accepts durationTarget at maximum boundary (40)', () => {
    const result = createEpisodeSchema.safeParse({
      title: 'My Episode',
      topic: 'A topic',
      metadata: { topic: 'A topic', durationTarget: 40 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects durationTarget below minimum (1)', () => {
    const result = createEpisodeSchema.safeParse({
      title: 'My Episode',
      topic: 'A topic',
      metadata: { topic: 'A topic', durationTarget: 0 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects durationTarget above maximum', () => {
    const result = createEpisodeSchema.safeParse({
      title: 'My Episode',
      topic: 'A topic',
      metadata: { topic: 'A topic', durationTarget: 45 },
    });
    expect(result.success).toBe(false);
  });

  it('accepts metadata without durationTarget (optional)', () => {
    const result = createEpisodeSchema.safeParse({
      title: 'My Episode',
      topic: 'A topic',
      metadata: { topic: 'A topic' },
    });
    expect(result.success).toBe(true);
  });
});

describe('interactionSchema', () => {
  it('accepts valid question and timestamp', () => {
    const result = interactionSchema.safeParse({
      question: 'Can you explain that concept?',
      timestamp: 120.5,
    });
    expect(result.success).toBe(true);
  });

  it('accepts timestamp of zero', () => {
    const result = interactionSchema.safeParse({
      question: 'What does this mean?',
      timestamp: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty question', () => {
    const result = interactionSchema.safeParse({
      question: '',
      timestamp: 10,
    });
    expect(result.success).toBe(false);
  });

  it('rejects question exceeding 2000 characters', () => {
    const result = interactionSchema.safeParse({
      question: 'a'.repeat(2001),
      timestamp: 10,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative timestamp', () => {
    const result = interactionSchema.safeParse({
      question: 'A question',
      timestamp: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing timestamp', () => {
    const result = interactionSchema.safeParse({
      question: 'A question',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing question', () => {
    const result = interactionSchema.safeParse({
      timestamp: 10,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric timestamp', () => {
    const result = interactionSchema.safeParse({
      question: 'A question',
      timestamp: 'not-a-number',
    });
    expect(result.success).toBe(false);
  });
});

describe('updateEpisodeSchema', () => {
  it('accepts valid partial update with title only', () => {
    const result = updateEpisodeSchema.safeParse({ title: 'New Title' });
    expect(result.success).toBe(true);
  });

  it('accepts valid partial update with topic only', () => {
    const result = updateEpisodeSchema.safeParse({ topic: 'Updated topic' });
    expect(result.success).toBe(true);
  });

  it('accepts valid partial update with visibility only', () => {
    const result = updateEpisodeSchema.safeParse({ visibility: 'PRIVATE' });
    expect(result.success).toBe(true);
  });

  it('accepts all fields together', () => {
    const result = updateEpisodeSchema.safeParse({
      title: 'New Title',
      topic: 'New Topic',
      visibility: 'PUBLIC',
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty object (all fields optional)', () => {
    const result = updateEpisodeSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts UNLISTED visibility', () => {
    const result = updateEpisodeSchema.safeParse({ visibility: 'UNLISTED' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid visibility value', () => {
    const result = updateEpisodeSchema.safeParse({ visibility: 'DRAFT' });
    expect(result.success).toBe(false);
  });

  it('rejects legacy remix fields', () => {
    const result = updateEpisodeSchema.safeParse({ remixNote: 'Different angle' });
    expect(result.success).toBe(false);
  });

  it('rejects empty title when provided', () => {
    const result = updateEpisodeSchema.safeParse({ title: '' });
    expect(result.success).toBe(false);
  });

  it('rejects title exceeding 200 characters', () => {
    const result = updateEpisodeSchema.safeParse({ title: 'a'.repeat(201) });
    expect(result.success).toBe(false);
  });

  it('rejects empty topic when provided', () => {
    const result = updateEpisodeSchema.safeParse({ topic: '' });
    expect(result.success).toBe(false);
  });
});

describe('configureAvatarsSchema', () => {
  it('accepts valid avatar config with heygen provider', () => {
    const result = configureAvatarsSchema.safeParse({
      avatars: [{ speaker: 'Host', avatarId: 'av-1', avatarProvider: 'heygen' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid avatar config with runway provider', () => {
    const result = configureAvatarsSchema.safeParse({
      avatars: [
        { speaker: 'Host', avatarId: 'influencer', avatarProvider: 'runway', isPreset: true },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.avatars[0].avatarProvider).toBe('runway');
      expect(result.data.avatars[0].isPreset).toBe(true);
    }
  });

  it('accepts avatars without optional avatarProvider and isPreset', () => {
    const result = configureAvatarsSchema.safeParse({
      avatars: [{ speaker: 'Host', avatarId: 'av-1' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.avatars[0].avatarProvider).toBeUndefined();
      expect(result.data.avatars[0].isPreset).toBeUndefined();
    }
  });

  it('rejects invalid avatarProvider value', () => {
    const result = configureAvatarsSchema.safeParse({
      avatars: [{ speaker: 'Host', avatarId: 'av-1', avatarProvider: 'invalid' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty avatars array', () => {
    const result = configureAvatarsSchema.safeParse({ avatars: [] });
    expect(result.success).toBe(false);
  });

  it('rejects more than 4 avatars', () => {
    const avatars = Array.from({ length: 5 }, (_, i) => ({
      speaker: `Speaker ${i}`,
      avatarId: `av-${i}`,
    }));
    const result = configureAvatarsSchema.safeParse({ avatars });
    expect(result.success).toBe(false);
  });

  it('rejects empty speaker name', () => {
    const result = configureAvatarsSchema.safeParse({
      avatars: [{ speaker: '', avatarId: 'av-1' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty avatarId', () => {
    const result = configureAvatarsSchema.safeParse({
      avatars: [{ speaker: 'Host', avatarId: '' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts multiple avatars with mixed providers', () => {
    const result = configureAvatarsSchema.safeParse({
      avatars: [
        { speaker: 'Host', avatarId: 'av-1', avatarProvider: 'heygen' },
        { speaker: 'Expert', avatarId: 'influencer', avatarProvider: 'runway', isPreset: true },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe('updateAvatarPositionsSchema', () => {
  it('accepts valid positions', () => {
    const result = updateAvatarPositionsSchema.safeParse({
      positions: [{ speaker: 'Host', posX: 0.1, posY: 0.5, width: 0.25, height: 0.35 }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects posX out of range', () => {
    const result = updateAvatarPositionsSchema.safeParse({
      positions: [{ speaker: 'Host', posX: 1.5, posY: 0.5, width: 0.25, height: 0.35 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects width below minimum', () => {
    const result = updateAvatarPositionsSchema.safeParse({
      positions: [{ speaker: 'Host', posX: 0.1, posY: 0.5, width: 0.01, height: 0.35 }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts empty positions array (clears all positions)', () => {
    const result = updateAvatarPositionsSchema.safeParse({ positions: [] });
    expect(result.success).toBe(true);
  });
});

describe('regenerateWithFeedbackSchema — sourceUrls', () => {
  it('accepts valid sourceUrls', () => {
    const result = regenerateWithFeedbackSchema.safeParse({
      sourceUrls: ['https://example.com/article', 'https://bbc.co.uk/news/123'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data?.sourceUrls).toHaveLength(2);
    }
  });

  it('rejects invalid URLs', () => {
    const result = regenerateWithFeedbackSchema.safeParse({
      sourceUrls: ['not-a-url'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 5 URLs', () => {
    const result = regenerateWithFeedbackSchema.safeParse({
      sourceUrls: Array.from({ length: 6 }, (_, i) => `https://example.com/${i}`),
    });
    expect(result.success).toBe(false);
  });

  it('accepts empty sourceUrls array', () => {
    const result = regenerateWithFeedbackSchema.safeParse({
      sourceUrls: [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts body without sourceUrls (backward compat)', () => {
    const result = regenerateWithFeedbackSchema.safeParse({
      feedback: 'Make it better',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data?.sourceUrls).toBeUndefined();
    }
  });
});
