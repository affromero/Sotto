/**
 * POST /api/v1/auth/owner — create the first owner. Public, but gated to local auth
 * on and zero users. Adversarial: refuses when local auth is off, refuses a
 * second owner, rate-limited, validates input.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockIsLocalAuthEnabled = vi.fn();
const mockCreateOwner = vi.fn();
const mockRateLimit = vi.fn();

vi.mock('@/lib/local-auth', () => ({
  isLocalAuthEnabled: (...a: unknown[]) => mockIsLocalAuthEnabled(...a),
}));
vi.mock('@/lib/local-account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/local-account')>('@/lib/local-account');
  return { ...actual, createOwner: (...a: unknown[]) => mockCreateOwner(...a) };
});
vi.mock('@/lib/redis', () => ({ checkRateLimit: (...a: unknown[]) => mockRateLimit(...a) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { POST } from '@/app/api/v1/auth/owner/route';
import { OwnerExistsError } from '@/lib/local-account';

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/auth/owner', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID = { name: 'Andres', password: 'supersecret1', avatar: 'capybara' };

describe('POST /api/v1/auth/owner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsLocalAuthEnabled.mockResolvedValue(true);
    mockRateLimit.mockResolvedValue(true);
    mockCreateOwner.mockResolvedValue({ id: 'owner1' });
  });

  it('refuses when local auth is off', async () => {
    mockIsLocalAuthEnabled.mockResolvedValue(false);
    const res = await POST(req(VALID));
    expect(res.status).toBe(403);
    expect(mockCreateOwner).not.toHaveBeenCalled();
  });

  it('creates the owner and returns the id', async () => {
    const res = await POST(req(VALID));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ userId: 'owner1' });
  });

  it('refuses a second owner with 403', async () => {
    mockCreateOwner.mockRejectedValue(new OwnerExistsError());
    const res = await POST(req(VALID));
    expect(res.status).toBe(403);
  });

  it('rate-limits aggressive attempts', async () => {
    mockRateLimit.mockResolvedValue(false);
    const res = await POST(req(VALID));
    expect(res.status).toBe(429);
    expect(mockCreateOwner).not.toHaveBeenCalled();
  });

  it('rejects a short password', async () => {
    const res = await POST(req({ ...VALID, password: 'short' }));
    expect(res.status).toBe(400);
  });
});
