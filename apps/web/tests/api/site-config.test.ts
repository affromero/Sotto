/**
 * Site config API — adversarial auth + behavior for the owner's server-infra
 * settings. A non-owner must never read or change them.
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
  const mod = await import('@/app/api/v1/admin/site-config/route');
  return { GET: mod.GET, PATCH: mod.PATCH };
}

function patchRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/v1/admin/site-config'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/v1/admin/site-config', () => {
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
    mockGetSiteConfig.mockResolvedValue({ aiProvider: 'openai' });
    const { GET } = await getHandlers();
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ aiProvider: 'openai' });
  });
});

describe('PATCH /api/v1/admin/site-config', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

  it('rejects a non-owner with 403 and never writes', async () => {
    mockRequireAdmin.mockResolvedValue(null);
    const { PATCH } = await getHandlers();
    const res = await PATCH(patchRequest({ aiProvider: 'openai' }));
    expect(res.status).toBe(403);
    expect(mockSetSiteConfig).not.toHaveBeenCalled();
  });

  it('lets the owner update infra config and returns it', async () => {
    mockRequireAdmin.mockResolvedValue('owner-1');
    mockSetSiteConfig.mockResolvedValue(undefined);
    mockGetSiteConfig.mockResolvedValue({ aiProvider: 'openai' });
    const { PATCH } = await getHandlers();
    const res = await PATCH(patchRequest({ aiProvider: 'openai' }));
    expect(res.status).toBe(200);
    expect(mockSetSiteConfig).toHaveBeenCalledWith({ aiProvider: 'openai' }, 'owner-1');
    await expect(res.json()).resolves.toEqual({ aiProvider: 'openai' });
  });

  it('rejects a malformed body with 400', async () => {
    mockRequireAdmin.mockResolvedValue('owner-1');
    const { PATCH } = await getHandlers();
    const res = await PATCH(patchRequest({ aiProvider: 123 }));
    expect(res.status).toBe(400);
    expect(mockSetSiteConfig).not.toHaveBeenCalled();
  });
});
