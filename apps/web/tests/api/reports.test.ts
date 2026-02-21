import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockReportCreate = vi.fn();
const mockPodcastFindUnique = vi.fn();
const mockCommentFindUnique = vi.fn();
const mockUserFindUnique = vi.fn();
const mockCheckRateLimit = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    report: {
      create: (...args: unknown[]) => mockReportCreate(...args),
    },
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
    },
    comment: {
      findUnique: (...args: unknown[]) => mockCommentFindUnique(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
  },
}));

vi.mock('@/lib/redis', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

import { POST } from '@/app/api/reports/route';

function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/reports'), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const ALL_REASONS = [
  'HARASSMENT',
  'HATE_SPEECH',
  'VIOLENCE',
  'SEXUAL_CONTENT',
  'MISINFORMATION',
  'SPAM',
  'IMPERSONATION',
  'COPYRIGHT',
  'VOICE_THEFT',
  'MUSIC_UPLOAD',
  'FALSE_HUMAN_BADGE',
  'FALSE_CLAIM',
  'OTHER',
] as const;

describe('POST /api/reports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    mockPodcastFindUnique.mockResolvedValue({ id: 'pod-1' });
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await POST(createRequest({ targetType: 'podcast', targetId: 'pod-1', reason: 'SPAM' }));
    expect(response.status).toBe(401);
  });

  it.each(ALL_REASONS)('accepts report reason %s', async (reason) => {
    mockReportCreate.mockResolvedValue({ id: 'report-1', status: 'PENDING' });

    const response = await POST(
      createRequest({ targetType: 'podcast', targetId: 'pod-1', reason })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.id).toBe('report-1');
  });

  it('rejects invalid reason values', async () => {
    const response = await POST(
      createRequest({ targetType: 'podcast', targetId: 'pod-1', reason: 'INVALID_REASON' })
    );
    expect(response.status).toBe(400);
  });

  it('auto-escalates FALSE_HUMAN_BADGE reports to REVIEWING', async () => {
    mockReportCreate.mockResolvedValue({ id: 'report-1', status: 'REVIEWING' });

    const response = await POST(
      createRequest({ targetType: 'podcast', targetId: 'pod-1', reason: 'FALSE_HUMAN_BADGE' })
    );
    expect(response.status).toBe(201);

    const createCall = mockReportCreate.mock.calls[0][0];
    expect(createCall.data.status).toBe('REVIEWING');
  });

  it('auto-escalates MUSIC_UPLOAD reports to REVIEWING', async () => {
    mockReportCreate.mockResolvedValue({ id: 'report-1', status: 'REVIEWING' });

    await POST(
      createRequest({ targetType: 'podcast', targetId: 'pod-1', reason: 'MUSIC_UPLOAD' })
    );

    const createCall = mockReportCreate.mock.calls[0][0];
    expect(createCall.data.status).toBe('REVIEWING');
  });

  it('auto-escalates VOICE_THEFT reports to REVIEWING', async () => {
    mockReportCreate.mockResolvedValue({ id: 'report-1', status: 'REVIEWING' });

    await POST(
      createRequest({ targetType: 'podcast', targetId: 'pod-1', reason: 'VOICE_THEFT' })
    );

    const createCall = mockReportCreate.mock.calls[0][0];
    expect(createCall.data.status).toBe('REVIEWING');
  });

  it('does not auto-escalate regular reports', async () => {
    mockReportCreate.mockResolvedValue({ id: 'report-1', status: 'PENDING' });

    await POST(
      createRequest({ targetType: 'podcast', targetId: 'pod-1', reason: 'SPAM' })
    );

    const createCall = mockReportCreate.mock.calls[0][0];
    expect(createCall.data.status).toBeUndefined();
  });
});
