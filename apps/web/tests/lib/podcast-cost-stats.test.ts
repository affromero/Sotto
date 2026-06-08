import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGroupBy = vi.fn();
const mockCount = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    apiUsageLog: { groupBy: (...args: unknown[]) => mockGroupBy(...args) },
    podcast: { count: (...args: unknown[]) => mockCount(...args), groupBy: (...args: unknown[]) => mockGroupBy(...args) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import {
  getCostBucket,
  CATEGORY_BUCKET_MAP,
  getPodcastCostBreakdown,
  getUserCostSummary,
} from '@/lib/podcast-cost-stats';

describe('getCostBucket', () => {
  it('maps all known text categories', () => {
    const textCategories = [
      'topic_assessment', 'script_generation', 'script_verification',
      'reference_validation', 'voice_assignment', 'tts-tag-conversion',
      'interaction', 'discovery', 'language_detection',
      'handle_screening', 'telegram_parse', 'inspire_foryou', 'inspire_news',
      'inspire_curiosity', 'name_moderation', 'credential_lookup', 'embedding',
      'diarization', 'import_metadata', 'moderation', 'tweet_parse',
      'explore', 'trending',
    ];
    for (const cat of textCategories) {
      expect(getCostBucket(cat)).toBe('text');
    }
  });

  it('maps all known audio categories', () => {
    const audioCategories = [
      'audio_generation', 'stt_transcription', 'segment_regeneration',
      'music_generation', 'voice_track_audio',
    ];
    for (const cat of audioCategories) {
      expect(getCostBucket(cat)).toBe('audio');
    }
  });

  it('maps video_generation to video', () => {
    expect(getCostBucket('video_generation')).toBe('video');
  });

  it('maps avatar_generation to avatar', () => {
    expect(getCostBucket('avatar_generation')).toBe('avatar');
  });

  it('falls back to text for unknown categories', () => {
    expect(getCostBucket('something_unknown')).toBe('text');
    expect(getCostBucket('')).toBe('text');
  });

  it('CATEGORY_BUCKET_MAP has entries for all expected categories', () => {
    expect(Object.keys(CATEGORY_BUCKET_MAP).length).toBe(30);
  });
});

describe('getPodcastCostBreakdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('aggregates costs into 4 buckets', async () => {
    mockGroupBy.mockResolvedValueOnce([
      { category: 'script_generation', _sum: { totalCost: 0.05 }, _count: { id: 2 } },
      { category: 'audio_generation', _sum: { totalCost: 0.12 }, _count: { id: 5 } },
      { category: 'video_generation', _sum: { totalCost: 0.30 }, _count: { id: 1 } },
      { category: 'avatar_generation', _sum: { totalCost: 0.08 }, _count: { id: 1 } },
    ]);

    const result = await getPodcastCostBreakdown('pod-1');

    expect(result.podcastId).toBe('pod-1');
    expect(result.text).toBeCloseTo(0.05);
    expect(result.audio).toBeCloseTo(0.12);
    expect(result.video).toBeCloseTo(0.30);
    expect(result.avatar).toBeCloseTo(0.08);
    expect(result.total).toBeCloseTo(0.55);
    expect(result.callCount).toBe(9);
  });

  it('returns zeros when no logs exist', async () => {
    mockGroupBy.mockResolvedValueOnce([]);

    const result = await getPodcastCostBreakdown('pod-empty');

    expect(result.total).toBe(0);
    expect(result.callCount).toBe(0);
    expect(result.text).toBe(0);
    expect(result.audio).toBe(0);
  });

  it('groups unknown categories into text', async () => {
    mockGroupBy.mockResolvedValueOnce([
      { category: 'future_category', _sum: { totalCost: 0.01 }, _count: { id: 1 } },
    ]);

    const result = await getPodcastCostBreakdown('pod-2');
    expect(result.text).toBe(0.01);
    expect(result.total).toBe(0.01);
  });
});

describe('getUserCostSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('computes all-time and monthly costs with buckets', async () => {
    // All-time groupBy
    mockGroupBy.mockResolvedValueOnce([
      { category: 'script_generation', _sum: { totalCost: 1.0 } },
      { category: 'audio_generation', _sum: { totalCost: 2.0 } },
    ]);
    // Month groupBy
    mockGroupBy.mockResolvedValueOnce([
      { category: 'script_generation', _sum: { totalCost: 0.5 } },
    ]);
    // Podcast count
    mockCount.mockResolvedValueOnce(10);

    const result = await getUserCostSummary('user-1');

    expect(result.totalCost).toBe(3.0);
    expect(result.monthCost).toBe(0.5);
    expect(result.podcastCount).toBe(10);
    expect(result.avgCostPerPodcast).toBe(0.3);
    expect(result.buckets.text).toBe(1.0);
    expect(result.buckets.audio).toBe(2.0);
    expect(result.buckets.video).toBe(0);
    expect(result.buckets.avatar).toBe(0);
  });

  it('handles zero podcasts without dividing by zero', async () => {
    mockGroupBy.mockResolvedValueOnce([]);
    mockGroupBy.mockResolvedValueOnce([]);
    mockCount.mockResolvedValueOnce(0);

    const result = await getUserCostSummary('user-empty');
    expect(result.avgCostPerPodcast).toBe(0);
  });
});
