// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuth(...args),
}));

const mockUserFindUnique = vi.fn();
const mockUserUpdate = vi.fn();
const mockUserDelete = vi.fn();
const mockUserCount = vi.fn();
const mockEpisodeFindMany = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...a: unknown[]) => mockUserFindUnique(...a),
      update: (...a: unknown[]) => mockUserUpdate(...a),
      delete: (...a: unknown[]) => mockUserDelete(...a),
      count: (...a: unknown[]) => mockUserCount(...a),
    },
    episode: { findMany: (...a: unknown[]) => mockEpisodeFindMany(...a) },
  },
}));

const mockCookieGet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: mockCookieGet })),
}));

vi.mock('@/lib/r2', () => ({
  deleteFile: vi.fn(async () => {}),
  listFiles: vi.fn(async () => []),
}));

import { PATCH, DELETE } from '@/app/api/v1/profiles/[id]/route';

function req(method: string, body?: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/v1/profiles/x'), {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe('PATCH /api/v1/profiles/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: 'local-user' });
  });

  it('404s when the profile does not exist', async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const res = await PATCH(req('PATCH', { name: 'New' }), ctx('member-1'));
    expect(res.status).toBe(404);
  });

  it('renames a profile', async () => {
    mockUserFindUnique.mockResolvedValue({ id: 'member-1' });
    mockUserUpdate.mockResolvedValue({
      id: 'member-1',
      name: 'Renamed',
      image: null,
      role: 'USER',
    });

    const res = await PATCH(req('PATCH', { name: 'Renamed' }), ctx('member-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe('Renamed');
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'member-1' },
      data: { name: 'Renamed' },
    });
  });

  it('sets a preset avatar from a slug', async () => {
    mockUserFindUnique.mockResolvedValue({ id: 'member-1' });
    mockUserUpdate.mockResolvedValue({
      id: 'member-1',
      name: 'Lena',
      image: '/avatars/jaguar.png',
      role: 'USER',
    });

    const res = await PATCH(req('PATCH', { avatarSlug: 'jaguar' }), ctx('member-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'member-1' },
      data: { image: '/avatars/jaguar.png' },
    });
    expect(body.avatarUrl).toBe('/avatars/jaguar.png');
  });

  it('rejects an unknown avatar slug', async () => {
    const res = await PATCH(req('PATCH', { avatarSlug: 'unicorn' }), ctx('member-1'));
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/v1/profiles/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: 'local-user' });
    mockCookieGet.mockReturnValue(undefined);
    mockEpisodeFindMany.mockResolvedValue([]);
    mockUserCount.mockResolvedValue(3);
  });

  it('refuses to delete the owner', async () => {
    const res = await DELETE(req('DELETE'), ctx('local-user'));
    expect(res.status).toBe(400);
    expect(mockUserDelete).not.toHaveBeenCalled();
  });

  it('404s when the profile does not exist', async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const res = await DELETE(req('DELETE'), ctx('ghost'));
    expect(res.status).toBe(404);
  });

  it('refuses to delete the last profile', async () => {
    mockUserFindUnique.mockResolvedValue({ id: 'member-1', image: null });
    mockUserCount.mockResolvedValue(1);
    const res = await DELETE(req('DELETE'), ctx('member-1'));
    expect(res.status).toBe(400);
    expect(mockUserDelete).not.toHaveBeenCalled();
  });

  it('deletes a non-owner profile', async () => {
    mockUserFindUnique.mockResolvedValue({ id: 'member-1', image: '/avatars/sloth.png' });
    mockUserDelete.mockResolvedValue({ id: 'member-1' });

    const res = await DELETE(req('DELETE'), ctx('member-1'));

    expect(res.status).toBe(200);
    expect(mockUserDelete).toHaveBeenCalledWith({ where: { id: 'member-1' } });
  });

  it('clears the cookie when the deleted profile is the active one', async () => {
    mockUserFindUnique.mockResolvedValue({ id: 'member-1', image: null });
    mockUserDelete.mockResolvedValue({ id: 'member-1' });
    mockCookieGet.mockReturnValue({ value: 'member-1' });

    const res = await DELETE(req('DELETE'), ctx('member-1'));

    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('sotto_profile=');
  });
});
