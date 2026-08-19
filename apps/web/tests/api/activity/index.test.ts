/**
 * GET /api/v1/activity. Adversarial: 401 unauth, 500 on the unexpected, and the
 * Map -> object serialization that JSON.stringify would otherwise flatten to {}.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockGetActivity = vi.fn();

vi.mock('@/lib/api-keys', () => ({ authenticateRequest: (...a: unknown[]) => mockAuth(...a) }));
vi.mock('@/lib/activity/heatmap', () => ({
  getActivityData: (...a: unknown[]) => mockGetActivity(...a),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { GET } from '@/app/api/v1/activity/route';

function req(): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/activity');
}

describe('GET /api/v1/activity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: 'u1' });
    mockGetActivity.mockResolvedValue({
      timeZone: 'America/Bogota',
      todayIso: '2026-08-18',
      days: new Map([
        ['2026-08-17', { class: 1, vocab: 2 }],
        ['2026-08-18', { speaking: 1 }],
      ]),
      currentStreak: 2,
      longestStreak: 9,
    });
  });

  it('rejects unauthenticated requests', async () => {
    mockAuth.mockResolvedValue(null);

    const res = await GET(req());

    expect(res.status).toBe(401);
    expect(mockGetActivity).not.toHaveBeenCalled();
  });

  it('serializes the day map into an object keyed by local day', async () => {
    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.days).toEqual({
      '2026-08-17': { class: 1, vocab: 2 },
      '2026-08-18': { speaking: 1 },
    });
  });

  it('returns the streaks and the timezone the days were bucketed in', async () => {
    const body = await (await GET(req())).json();

    expect(body.currentStreak).toBe(2);
    expect(body.longestStreak).toBe(9);
    expect(body.timeZone).toBe('America/Bogota');
    expect(body.todayIso).toBe('2026-08-18');
  });

  it('scopes the query to the authenticated learner', async () => {
    await GET(req());

    expect(mockGetActivity).toHaveBeenCalledWith('u1');
  });

  it('answers 500 when the query fails', async () => {
    mockGetActivity.mockRejectedValue(new Error('db down'));

    const res = await GET(req());

    expect(res.status).toBe(500);
  });

  it('serializes an empty history as an empty object, not an empty array', async () => {
    mockGetActivity.mockResolvedValue({
      timeZone: 'UTC',
      todayIso: '2026-08-18',
      days: new Map(),
      currentStreak: 0,
      longestStreak: 0,
    });

    const body = await (await GET(req())).json();

    expect(body.days).toEqual({});
  });
});
