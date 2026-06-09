/**
 * Site config API — adversarial auth + behavior for the household signup toggle.
 *
 * The owner controls whether new accounts are invite-only (default) or open. A
 * non-owner must never be able to read or flip it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockRequireAdmin = vi.fn();
vi.mock('@/lib/auth-guards', () => ({
  requireAdmin: () => mockRequireAdmin(),
}));

const mockGetSiteConfig = vi.fn();
const mockSetSiteConfig = vi.fn();
vi.mock('@/lib/site-config', () => ({
  getSiteConfig: () => mockGetSiteConfig(),
  setSiteConfig: (...args: unknown[]) => mockSetSiteConfig(...args),
}));

vi.mock('@/lib/api-response', () => ({
  errorResponse: (message: unknown, status: number) =>
    new Response(JSON.stringify({ error: message }), { status }),
}));

async function getHandlers() {
  const mod = await import('@/app/api/admin/site-config/route');
  return { GET: mod.GET, PATCH: mod.PATCH };
}

function patchRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/admin/site-config'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/admin/site-config', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

  it('rejects a non-owner with 403', async () => {
    mockRequireAdmin.mockResolvedValue(null);
    const { GET } = await getHandlers();
    const res = await GET();
    expect(res.status).toBe(403);
    expect(mockGetSiteConfig).not.toHaveBeenCalled();
  });

  it('returns the config for the owner', async () => {
    mockRequireAdmin.mockResolvedValue('owner-1');
    mockGetSiteConfig.mockResolvedValue({ openSignup: false });
    const { GET } = await getHandlers();
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ openSignup: false });
  });
});

describe('PATCH /api/admin/site-config', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

  it('rejects a non-owner with 403 and never writes', async () => {
    mockRequireAdmin.mockResolvedValue(null);
    const { PATCH } = await getHandlers();
    const res = await PATCH(patchRequest({ openSignup: true }));
    expect(res.status).toBe(403);
    expect(mockSetSiteConfig).not.toHaveBeenCalled();
  });

  it('lets the owner open sign-up and returns the updated config', async () => {
    mockRequireAdmin.mockResolvedValue('owner-1');
    mockSetSiteConfig.mockResolvedValue(undefined);
    mockGetSiteConfig.mockResolvedValue({ openSignup: true });
    const { PATCH } = await getHandlers();
    const res = await PATCH(patchRequest({ openSignup: true }));
    expect(res.status).toBe(200);
    expect(mockSetSiteConfig).toHaveBeenCalledWith({ openSignup: true }, 'owner-1');
    await expect(res.json()).resolves.toEqual({ openSignup: true });
  });

  it('rejects a malformed body with 400', async () => {
    mockRequireAdmin.mockResolvedValue('owner-1');
    const { PATCH } = await getHandlers();
    const res = await PATCH(patchRequest({ openSignup: 'yes' }));
    expect(res.status).toBe(400);
    expect(mockSetSiteConfig).not.toHaveBeenCalled();
  });
});
