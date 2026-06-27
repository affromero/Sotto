// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuth(...args),
}));

const mockUserFindUnique = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: (...a: unknown[]) => mockUserFindUnique(...a) } },
}));

import { DELETE, POST } from '@/app/api/v1/profiles/switch/route';

function req(body?: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/v1/profiles/switch'), {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/v1/profiles/switch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: 'local-user' });
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(req({ profileId: 'member-1' }));
    expect(res.status).toBe(401);
  });

  it('400s on a missing profileId', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it('404s when the target profile does not exist', async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const res = await POST(req({ profileId: 'ghost' }));
    expect(res.status).toBe(404);
  });

  it('sets the active-profile cookie for a valid target', async () => {
    mockUserFindUnique.mockResolvedValue({ id: 'member-1' });

    const res = await POST(req({ profileId: 'member-1' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, profileId: 'member-1' });
    const cookies = res.headers.getSetCookie();
    expect(
      cookies.some((c) => c.startsWith('sotto_profile=member-1') && c.includes('HttpOnly'))
    ).toBe(true);
    expect(cookies.some((c) => c.startsWith('sotto_theme='))).toBe(true);
  });
});

describe('DELETE /api/v1/profiles/switch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: 'local-user' });
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);
    const res = await DELETE(req());
    expect(res.status).toBe(401);
  });

  it('clears the active profile and theme cookies', async () => {
    const res = await DELETE(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    const cookies = res.headers.getSetCookie();
    expect(
      cookies.some((c) => c.startsWith('sotto_profile=') && c.includes('Expires=Thu, 01 Jan 1970'))
    ).toBe(true);
    expect(
      cookies.some((c) => c.startsWith('sotto_theme=') && c.includes('Expires=Thu, 01 Jan 1970'))
    ).toBe(true);
  });
});
