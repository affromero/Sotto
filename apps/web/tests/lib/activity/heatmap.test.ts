/**
 * Unit tests for src/lib/activity/heatmap.ts — timezone-aware day bucketing,
 * streak computation, and the three-source activity query.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUserFindUnique = vi.fn();
const mockPracticeFindMany = vi.fn();
const mockClassFindMany = vi.fn();
const mockExamFindMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (...a: unknown[]) => mockUserFindUnique(...a) },
    practiceSession: { findMany: (...a: unknown[]) => mockPracticeFindMany(...a) },
    classSubmission: { findMany: (...a: unknown[]) => mockClassFindMany(...a) },
    examSubmission: { findMany: (...a: unknown[]) => mockExamFindMany(...a) },
  },
}));

import {
  bucketEvents,
  computeStreaks,
  getActivityData,
  isValidTimezone,
  localDayIso,
  resolveTimezone,
} from '@/lib/activity/heatmap';

beforeEach(() => {
  vi.clearAllMocks();
  mockUserFindUnique.mockResolvedValue({ timezone: 'UTC' });
  mockPracticeFindMany.mockResolvedValue([]);
  mockClassFindMany.mockResolvedValue([]);
  mockExamFindMany.mockResolvedValue([]);
});

describe('localDayIso', () => {
  it('buckets an evening PST session on the local day, not the UTC day', () => {
    // 2026-08-17 20:00 in Los Angeles = 2026-08-18 03:00 UTC.
    const at = new Date('2026-08-18T03:00:00Z');
    expect(localDayIso(at, 'America/Los_Angeles')).toBe('2026-08-17');
    expect(localDayIso(at, 'UTC')).toBe('2026-08-18');
  });
});

describe('resolveTimezone', () => {
  it('keeps a valid stored zone and rejects invalid or missing ones', () => {
    expect(resolveTimezone('America/Mexico_City')).toBe('America/Mexico_City');
    const serverZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(resolveTimezone(null)).toBe(serverZone);
    expect(resolveTimezone('Not/AZone')).toBe(serverZone);
  });

  it('isValidTimezone accepts IANA names and rejects garbage', () => {
    expect(isValidTimezone('Europe/Berlin')).toBe(true);
    expect(isValidTimezone('CET nonsense')).toBe(false);
  });
});

describe('bucketEvents', () => {
  it('counts events per local day and category', () => {
    const days = bucketEvents(
      [
        { at: new Date('2026-08-10T10:00:00Z'), category: 'vocab' },
        { at: new Date('2026-08-10T11:00:00Z'), category: 'vocab' },
        { at: new Date('2026-08-10T12:00:00Z'), category: 'class' },
        { at: new Date('2026-08-12T09:00:00Z'), category: 'speaking' },
      ],
      'UTC'
    );
    expect(days.get('2026-08-10')).toEqual({ vocab: 2, class: 1 });
    expect(days.get('2026-08-12')).toEqual({ speaking: 1 });
    expect(days.has('2026-08-11')).toBe(false);
  });
});

describe('computeStreaks', () => {
  it('counts a run ending today as the current streak', () => {
    const { current, longest } = computeStreaks(
      ['2026-08-15', '2026-08-16', '2026-08-17'],
      '2026-08-17'
    );
    expect(current).toBe(3);
    expect(longest).toBe(3);
  });

  it('keeps the streak alive when today has no activity yet', () => {
    const { current } = computeStreaks(['2026-08-15', '2026-08-16'], '2026-08-17');
    expect(current).toBe(2);
  });

  it('reports zero current but remembers the longest past run', () => {
    const { current, longest } = computeStreaks(
      ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-08-10'],
      '2026-08-17'
    );
    expect(current).toBe(0);
    expect(longest).toBe(4);
  });

  it('crosses month boundaries', () => {
    const { longest } = computeStreaks(['2026-07-31', '2026-08-01'], '2026-08-17');
    expect(longest).toBe(2);
  });

  it('handles no activity at all', () => {
    expect(computeStreaks([], '2026-08-17')).toEqual({ current: 0, longest: 0 });
  });
});

describe('getActivityData', () => {
  it('merges practice kinds, classes, and exams into per-day counts', async () => {
    mockPracticeFindMany.mockResolvedValue([
      { kind: 'VOCAB', completedAt: new Date('2026-08-10T10:00:00Z') },
      { kind: 'GRAMMAR', completedAt: new Date('2026-08-10T11:00:00Z') },
    ]);
    mockClassFindMany.mockResolvedValue([{ submittedAt: new Date('2026-08-10T12:00:00Z') }]);
    mockExamFindMany.mockResolvedValue([{ submittedAt: new Date('2026-08-11T12:00:00Z') }]);

    const data = await getActivityData('u1');
    expect(data.timeZone).toBe('UTC');
    expect(data.days.get('2026-08-10')).toEqual({ vocab: 1, grammar: 1, class: 1 });
    expect(data.days.get('2026-08-11')).toEqual({ exam: 1 });
  });

  it('scopes every query to the user and the 365-day window', async () => {
    await getActivityData('u1');
    expect(mockPracticeFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ course: { userId: 'u1' } }),
      })
    );
    expect(mockClassFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'u1' }) })
    );
    expect(mockExamFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ exam: { userId: 'u1' } }) })
    );
  });

  it('falls back to the server timezone when the user never picked one', async () => {
    mockUserFindUnique.mockResolvedValue({ timezone: null });
    const data = await getActivityData('u1');
    expect(data.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});
