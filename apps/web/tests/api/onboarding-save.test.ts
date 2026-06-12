/**
 * POST /api/v1/onboarding/save — the unified welcome-wizard persistence. Persists
 * the course, note, preferences, and (owner-only) server infra, then marks
 * onboarding complete. On the managed showcase (SELF_HOSTED=false) it writes
 * nothing and returns { demo: true }.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockRequireAdmin = vi.fn();
const mockIsSelfHosted = vi.fn();
const mockGetOrCreateCurriculum = vi.fn();
const mockCourseUpsert = vi.fn();
const mockUserUpdate = vi.fn();
const mockSetCourseNote = vi.fn();
const mockSetSiteConfig = vi.fn();
const mockInvalidate = vi.fn();

vi.mock('@/lib/auth', () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock('@/lib/auth-guards', () => ({
  requireAdmin: (...a: unknown[]) => mockRequireAdmin(...a),
}));
vi.mock('@/lib/self-hosted', () => ({
  isSelfHosted: (...a: unknown[]) => mockIsSelfHosted(...a),
}));
vi.mock('@/lib/curriculum-generator', () => ({
  getOrCreateCurriculum: (...a: unknown[]) => mockGetOrCreateCurriculum(...a),
}));
vi.mock('@/lib/course-notes', () => ({
  setCourseNote: (...a: unknown[]) => mockSetCourseNote(...a),
}));
vi.mock('@/lib/site-config', () => ({
  setSiteConfig: (...a: unknown[]) => mockSetSiteConfig(...a),
}));
vi.mock('@/lib/server-config', () => ({
  invalidateServerInfra: (...a: unknown[]) => mockInvalidate(...a),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    course: { upsert: (...a: unknown[]) => mockCourseUpsert(...a) },
    user: { update: (...a: unknown[]) => mockUserUpdate(...a) },
  },
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from '@/app/api/v1/onboarding/save/route';

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/onboarding/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const BASE = {
  course: { native: 'en', target: 'de', level: 'B1' as const },
  note: 'I build distributed systems',
  preferred: { language: 'de', aiProvider: 'local', aiModel: 'local:qwen3' },
};

describe('POST /api/v1/onboarding/save', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: 'u1' } });
    mockIsSelfHosted.mockReturnValue(true);
    mockRequireAdmin.mockResolvedValue(null);
    mockGetOrCreateCurriculum.mockResolvedValue({ id: 'cur1' });
    mockCourseUpsert.mockResolvedValue({ id: 'course1' });
    mockUserUpdate.mockResolvedValue({});
  });

  it('rejects an unauthenticated request', async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(req(BASE));
    expect(res.status).toBe(401);
    expect(mockCourseUpsert).not.toHaveBeenCalled();
  });

  it('writes nothing and returns demo on the managed showcase', async () => {
    mockIsSelfHosted.mockReturnValue(false);
    const res = await POST(req(BASE));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ demo: true });
    expect(mockAuth).not.toHaveBeenCalled();
    expect(mockCourseUpsert).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockSetSiteConfig).not.toHaveBeenCalled();
  });

  it('creates the course at the placement level and completes onboarding', async () => {
    const res = await POST(req(BASE));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ demo: false, courseId: 'course1' });

    // Course created at the chosen level (only via create, never clobbering update)
    const upsertArg = mockCourseUpsert.mock.calls[0][0];
    expect(upsertArg.create).toMatchObject({
      currentLevel: 'B1',
      startLevel: 'B1',
      nativeLang: 'en',
      targetLang: 'de',
    });
    expect(upsertArg.update).toEqual({});

    // Note persisted + onboarding marked complete
    expect(mockSetCourseNote).toHaveBeenCalledWith('course1', BASE.note);
    const completed = mockUserUpdate.mock.calls.some(
      (c) => c[0]?.data?.hasCompletedOnboarding === true
    );
    expect(completed).toBe(true);
  });

  it('rejects a non-owner attempting to set server infra (403)', async () => {
    mockRequireAdmin.mockResolvedValue(null);
    const res = await POST(req({ ...BASE, infra: { ttsProvider: 'kokoro' } }));
    expect(res.status).toBe(403);
    expect(mockSetSiteConfig).not.toHaveBeenCalled();
    expect(mockCourseUpsert).not.toHaveBeenCalled();
  });

  it('persists server infra when the caller is the owner', async () => {
    mockRequireAdmin.mockResolvedValue('u1');
    const res = await POST(
      req({ ...BASE, infra: { ttsProvider: 'kokoro', ttsBaseUrl: 'http://localhost:8000' } })
    );
    expect(res.status).toBe(200);
    expect(mockSetSiteConfig).toHaveBeenCalledWith(
      expect.objectContaining({ ttsProvider: 'kokoro', ttsBaseUrl: 'http://localhost:8000' }),
      'u1'
    );
    expect(mockInvalidate).toHaveBeenCalled();
  });

  it('rejects identical native and target languages', async () => {
    const res = await POST(req({ ...BASE, course: { native: 'en', target: 'en' } }));
    expect(res.status).toBe(400);
    expect(mockCourseUpsert).not.toHaveBeenCalled();
  });
});
