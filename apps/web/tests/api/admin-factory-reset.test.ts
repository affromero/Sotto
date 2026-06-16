// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockRequireAdmin = vi.fn();
vi.mock('@/lib/auth-guards', () => ({
  requireAdmin: () => mockRequireAdmin(),
}));

const mockFactoryReset = vi.fn();
vi.mock('@/lib/admin/factory-reset', () => ({
  factoryReset: () => mockFactoryReset(),
}));

const mockInvalidateServerInfra = vi.fn();
vi.mock('@/lib/server-config', () => ({
  invalidateServerInfra: () => mockInvalidateServerInfra(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@/lib/api-response', () => ({
  errorResponse: (message: unknown, status: number) =>
    new Response(JSON.stringify({ error: message }), { status }),
}));

async function getHandler() {
  const mod = await import('@/app/api/v1/admin/factory-reset/route');
  return mod.POST;
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/v1/admin/factory-reset'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/admin/factory-reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a non-admin without resetting', async () => {
    mockRequireAdmin.mockResolvedValue(null);
    const POST = await getHandler();

    const res = await POST(postRequest({ confirm: 'DELETE EVERYTHING' }));

    expect(res.status).toBe(403);
    expect(mockFactoryReset).not.toHaveBeenCalled();
    expect(mockInvalidateServerInfra).not.toHaveBeenCalled();
  });

  it('requires the destructive confirmation phrase', async () => {
    mockRequireAdmin.mockResolvedValue('local-user');
    const POST = await getHandler();

    const res = await POST(postRequest({ confirm: 'DELETE' }));

    expect(res.status).toBe(400);
    expect(mockFactoryReset).not.toHaveBeenCalled();
    expect(mockInvalidateServerInfra).not.toHaveBeenCalled();
  });

  it('runs the reset, invalidates cached infra, and clears profile cookies', async () => {
    mockRequireAdmin.mockResolvedValue('local-user');
    mockFactoryReset.mockResolvedValue({
      usersDeleted: 2,
      episodesDeleted: 4,
      filesAttempted: 6,
      filesDeleted: 5,
      filesFailed: 1,
    });
    const POST = await getHandler();

    const res = await POST(postRequest({ confirm: 'DELETE EVERYTHING' }));
    const body = await res.json();
    const cookies = res.headers.get('set-cookie') ?? '';

    expect(res.status).toBe(200);
    expect(mockFactoryReset).toHaveBeenCalledTimes(1);
    expect(mockInvalidateServerInfra).toHaveBeenCalledTimes(1);
    expect(body).toEqual({
      success: true,
      redirectTo: '/welcome?reset=1',
      usersDeleted: 2,
      episodesDeleted: 4,
      filesAttempted: 6,
      filesDeleted: 5,
      filesFailed: 1,
    });
    expect(cookies).toContain('sotto_profile=');
    expect(cookies).toContain('sotto_theme=');
  });
});
