import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuth = vi.fn();
const mockWaitlistFindMany = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    waitlist: {
      findMany: (...args: unknown[]) => mockWaitlistFindMany(...args),
    },
  },
}));

import { GET } from '@/app/api/admin/waitlist/export/route';

describe('GET /api/admin/waitlist/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 403 when user is not admin', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'USER' } });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('returns CSV with waitlist entries', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    const entries = [
      { email: 'alice@test.com', source: 'landing', createdAt: new Date('2026-01-15T10:00:00Z') },
      { email: 'bob@test.com', source: null, createdAt: new Date('2026-01-16T12:00:00Z') },
    ];
    mockWaitlistFindMany.mockResolvedValue(entries);

    const response = await GET();
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/csv');
    expect(response.headers.get('Content-Disposition')).toContain('waitlist-');
    expect(text).toContain('Email,Source,Signed Up');
    expect(text).toContain('alice@test.com,landing,');
    expect(text).toContain('bob@test.com,unknown,');
  });

  it('returns CSV with only header when no entries', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockWaitlistFindMany.mockResolvedValue([]);

    const response = await GET();
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toBe('Email,Source,Signed Up');
  });

  it('returns 500 when database throws', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockWaitlistFindMany.mockRejectedValue(new Error('DB error'));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to export waitlist' });
  });
});
