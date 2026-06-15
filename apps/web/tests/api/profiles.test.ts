// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuth(...args),
}));

const mockGetHousehold = vi.fn();
vi.mock('@/lib/profiles', () => ({
  getHouseholdProfiles: (...args: unknown[]) => mockGetHousehold(...args),
}));

const mockCreateProfile = vi.fn();
vi.mock('@/lib/local-user', () => ({
  createProfile: (...args: unknown[]) => mockCreateProfile(...args),
}));

import { GET, POST } from '@/app/api/v1/profiles/route';

function jsonRequest(method: string, body?: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/v1/profiles'), {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GET /api/v1/profiles', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(jsonRequest('GET'));
    expect(res.status).toBe(401);
  });

  it('lists the household and flags the active profile', async () => {
    mockAuth.mockResolvedValue({ userId: 'member-1' });
    mockGetHousehold.mockResolvedValue([
      { id: 'local-user', name: 'Owner', isOwner: true },
      { id: 'member-1', name: 'Lena', isOwner: false },
    ]);

    const res = await GET(jsonRequest('GET'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.profiles).toHaveLength(2);
    expect(body.profiles[0]).toMatchObject({ id: 'local-user', isActive: false });
    expect(body.profiles[1]).toMatchObject({ id: 'member-1', isActive: true });
  });
});

describe('POST /api/v1/profiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: 'local-user' });
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(jsonRequest('POST', { name: 'Lena' }));
    expect(res.status).toBe(401);
  });

  it('creates a profile and returns 201 with a resolved avatar', async () => {
    mockCreateProfile.mockResolvedValue({
      id: 'new-1',
      name: 'Lena',
      image: '/avatars/toucan.png',
      role: 'USER',
    });

    const res = await POST(jsonRequest('POST', { name: 'Lena', avatarSlug: 'toucan' }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toMatchObject({ id: 'new-1', name: 'Lena', isOwner: false, role: 'USER' });
    expect(body.avatarUrl).toBe('/avatars/toucan.png');
    expect(mockCreateProfile).toHaveBeenCalledWith({ name: 'Lena', avatarSlug: 'toucan' });
  });

  it('rejects an empty name', async () => {
    const res = await POST(jsonRequest('POST', { name: '   ' }));
    expect(res.status).toBe(400);
    expect(mockCreateProfile).not.toHaveBeenCalled();
  });

  it('rejects an unknown avatar slug', async () => {
    const res = await POST(jsonRequest('POST', { name: 'Lena', avatarSlug: 'dragon' }));
    expect(res.status).toBe(400);
  });

  it('rejects unexpected fields (strict schema)', async () => {
    const res = await POST(jsonRequest('POST', { name: 'Lena', role: 'ADMIN' }));
    expect(res.status).toBe(400);
  });
});
