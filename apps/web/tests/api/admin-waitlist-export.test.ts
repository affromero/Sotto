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
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 403 when user is not admin', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'USER' } });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: 'Forbidden' });
  });

  it('returns CSV with waitlist entries', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    const entries = [
      { email: 'alice@test.com', twitterHandle: 'alice', source: 'landing', referralCode: 'andres', wishlist: 'Would love podcast remixing!', status: 'APPROVED', createdAt: new Date('2026-01-15T10:00:00Z'), approvedAt: new Date('2026-01-16T00:00:00Z'), signedUpAt: null },
      { email: 'bob@test.com', twitterHandle: null, source: null, referralCode: null, wishlist: null, status: 'PENDING', createdAt: new Date('2026-01-16T12:00:00Z'), approvedAt: null, signedUpAt: null },
    ];
    mockWaitlistFindMany.mockResolvedValue(entries);

    const response = await GET();
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/csv');
    expect(response.headers.get('Content-Disposition')).toContain('waitlist-');
    expect(text).toContain('Email,Twitter,Source,Referral,Wishlist,Status,Signed Up,Approved At,Converted At');
    expect(text).toContain('alice@test.com,alice,landing,andres,Would love podcast remixing!,APPROVED,');
    expect(text).toContain('bob@test.com,,unknown,,,PENDING,');
  });

  it('returns CSV with only header when no entries', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockWaitlistFindMany.mockResolvedValue([]);

    const response = await GET();
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toBe('Email,Twitter,Source,Referral,Wishlist,Status,Signed Up,Approved At,Converted At');
  });

  it('returns 500 when database throws', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockWaitlistFindMany.mockRejectedValue(new Error('DB error'));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ error: 'Failed to export waitlist' });
  });
});
