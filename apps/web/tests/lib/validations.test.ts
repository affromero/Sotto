import { describe, it, expect } from 'vitest';
import {
  discoveryMessageSchema,
  createPodcastSchema,
  interactionSchema,
  updatePodcastSchema,
  feedQuerySchema,
} from '@/lib/validations';

describe('discoveryMessageSchema', () => {
  it('accepts valid content', () => {
    const result = discoveryMessageSchema.safeParse({ content: 'Tell me about quantum physics' });
    expect(result.success).toBe(true);
  });

  it('accepts content with optional podcastId', () => {
    const result = discoveryMessageSchema.safeParse({
      content: 'Tell me more',
      podcastId: 'abc-123',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.podcastId).toBe('abc-123');
    }
  });

  it('accepts content without podcastId', () => {
    const result = discoveryMessageSchema.safeParse({ content: 'Hello' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.podcastId).toBeUndefined();
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

describe('createPodcastSchema', () => {
  it('accepts valid input', () => {
    const result = createPodcastSchema.safeParse({
      title: 'Quantum Physics 101',
      topic: 'An introduction to quantum mechanics for beginners',
      discoveryId: 'disc-123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty title', () => {
    const result = createPodcastSchema.safeParse({
      title: '',
      topic: 'Some topic',
      discoveryId: 'disc-123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects title exceeding 200 characters', () => {
    const result = createPodcastSchema.safeParse({
      title: 'a'.repeat(201),
      topic: 'Some topic',
      discoveryId: 'disc-123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty topic', () => {
    const result = createPodcastSchema.safeParse({
      title: 'My Podcast',
      topic: '',
      discoveryId: 'disc-123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects topic exceeding 5000 characters', () => {
    const result = createPodcastSchema.safeParse({
      title: 'My Podcast',
      topic: 'a'.repeat(5001),
      discoveryId: 'disc-123',
    });
    expect(result.success).toBe(false);
  });

  it('accepts missing discoveryId (optional for Twitter/API sources)', () => {
    const result = createPodcastSchema.safeParse({
      title: 'My Podcast',
      topic: 'A topic',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing title', () => {
    const result = createPodcastSchema.safeParse({
      topic: 'A topic',
      discoveryId: 'disc-123',
    });
    expect(result.success).toBe(false);
  });

  it('accepts title at exactly 200 characters', () => {
    const result = createPodcastSchema.safeParse({
      title: 'a'.repeat(200),
      topic: 'A topic',
      discoveryId: 'disc-123',
    });
    expect(result.success).toBe(true);
  });

  it('accepts durationTarget within valid range', () => {
    const result = createPodcastSchema.safeParse({
      title: 'My Podcast',
      topic: 'A topic',
      metadata: { topic: 'A topic', durationTarget: 20 },
    });
    expect(result.success).toBe(true);
  });

  it('accepts durationTarget at minimum boundary (1)', () => {
    const result = createPodcastSchema.safeParse({
      title: 'My Podcast',
      topic: 'A topic',
      metadata: { topic: 'A topic', durationTarget: 1 },
    });
    expect(result.success).toBe(true);
  });

  it('accepts durationTarget at maximum boundary (40)', () => {
    const result = createPodcastSchema.safeParse({
      title: 'My Podcast',
      topic: 'A topic',
      metadata: { topic: 'A topic', durationTarget: 40 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects durationTarget below minimum (1)', () => {
    const result = createPodcastSchema.safeParse({
      title: 'My Podcast',
      topic: 'A topic',
      metadata: { topic: 'A topic', durationTarget: 0 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects durationTarget above maximum', () => {
    const result = createPodcastSchema.safeParse({
      title: 'My Podcast',
      topic: 'A topic',
      metadata: { topic: 'A topic', durationTarget: 45 },
    });
    expect(result.success).toBe(false);
  });

  it('accepts metadata without durationTarget (optional)', () => {
    const result = createPodcastSchema.safeParse({
      title: 'My Podcast',
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

describe('updatePodcastSchema', () => {
  it('accepts valid partial update with title only', () => {
    const result = updatePodcastSchema.safeParse({ title: 'New Title' });
    expect(result.success).toBe(true);
  });

  it('accepts valid partial update with topic only', () => {
    const result = updatePodcastSchema.safeParse({ topic: 'Updated topic' });
    expect(result.success).toBe(true);
  });

  it('accepts valid partial update with visibility only', () => {
    const result = updatePodcastSchema.safeParse({ visibility: 'PRIVATE' });
    expect(result.success).toBe(true);
  });

  it('accepts all fields together', () => {
    const result = updatePodcastSchema.safeParse({
      title: 'New Title',
      topic: 'New Topic',
      visibility: 'PUBLIC',
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty object (all fields optional)', () => {
    const result = updatePodcastSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts UNLISTED visibility', () => {
    const result = updatePodcastSchema.safeParse({ visibility: 'UNLISTED' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid visibility value', () => {
    const result = updatePodcastSchema.safeParse({ visibility: 'DRAFT' });
    expect(result.success).toBe(false);
  });

  it('rejects empty title when provided', () => {
    const result = updatePodcastSchema.safeParse({ title: '' });
    expect(result.success).toBe(false);
  });

  it('rejects title exceeding 200 characters', () => {
    const result = updatePodcastSchema.safeParse({ title: 'a'.repeat(201) });
    expect(result.success).toBe(false);
  });

  it('rejects empty topic when provided', () => {
    const result = updatePodcastSchema.safeParse({ topic: '' });
    expect(result.success).toBe(false);
  });
});

describe('feedQuerySchema', () => {
  it('applies defaults for empty input', () => {
    const result = feedQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
      expect(result.data.sort).toBe('recent');
    }
  });

  it('accepts valid pagination parameters', () => {
    const result = feedQuerySchema.safeParse({ page: 3, limit: 10 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.limit).toBe(10);
    }
  });

  it('coerces string numbers for page and limit', () => {
    const result = feedQuerySchema.safeParse({ page: '2', limit: '15' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(2);
      expect(result.data.limit).toBe(15);
    }
  });

  it('rejects page less than 1', () => {
    const result = feedQuerySchema.safeParse({ page: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects limit greater than 50', () => {
    const result = feedQuerySchema.safeParse({ limit: 51 });
    expect(result.success).toBe(false);
  });

  it('rejects limit less than 1', () => {
    const result = feedQuerySchema.safeParse({ limit: 0 });
    expect(result.success).toBe(false);
  });

  it('accepts search string', () => {
    const result = feedQuerySchema.safeParse({ search: 'quantum physics' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.search).toBe('quantum physics');
    }
  });

  it('rejects search exceeding 200 characters', () => {
    const result = feedQuerySchema.safeParse({ search: 'a'.repeat(201) });
    expect(result.success).toBe(false);
  });

  it('accepts tag parameter', () => {
    const result = feedQuerySchema.safeParse({ tag: 'science' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tag).toBe('science');
    }
  });

  it('accepts sort by popular', () => {
    const result = feedQuerySchema.safeParse({ sort: 'popular' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sort).toBe('popular');
    }
  });

  it('accepts sort by trending', () => {
    const result = feedQuerySchema.safeParse({ sort: 'trending' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sort).toBe('trending');
    }
  });

  it('rejects invalid sort option', () => {
    const result = feedQuerySchema.safeParse({ sort: 'alphabetical' });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer page', () => {
    const result = feedQuerySchema.safeParse({ page: 1.5 });
    expect(result.success).toBe(false);
  });
});

