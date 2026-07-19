import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockCheckRateLimit = vi.fn();
vi.mock('@/lib/redis', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

import { POST } from '@/app/api/v1/gate/route';
import { GET as redeemInvite } from '@/app/invite/route';
import { createInviteToken, verifyGateToken } from '@/lib/access/gate';

function gateRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/gate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('access gate routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SOTTO_ACCESS_PASSWORD = 'family-secret';
    process.env.BYOK_ENCRYPTION_KEY = 'test-signing-key-material-0123456789abcdef';
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 4,
      resetAt: Date.now() + 60_000,
    });
  });

  afterEach(() => {
    delete process.env.SOTTO_ACCESS_PASSWORD;
  });

  describe('POST /api/v1/gate', () => {
    it('opens the gate with the right password and sets a valid cookie', async () => {
      const res = await POST(gateRequest({ password: 'family-secret' }));

      expect(res.status).toBe(200);
      const cookie = res.cookies.get('sotto_gate');
      expect(cookie).toBeDefined();
      expect(await verifyGateToken(cookie?.value)).toBe(true);
    });

    it('rejects a wrong password with 401 and no cookie', async () => {
      const res = await POST(gateRequest({ password: 'nope' }));

      expect(res.status).toBe(401);
      expect(res.cookies.get('sotto_gate')).toBeUndefined();
    });

    it('rejects a missing password with 400', async () => {
      const res = await POST(gateRequest({}));
      expect(res.status).toBe(400);
    });

    it('returns 429 with Retry-After when rate limited', async () => {
      mockCheckRateLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 30_000,
      });

      const res = await POST(gateRequest({ password: 'family-secret' }));

      expect(res.status).toBe(429);
      expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    });

    it('is 404 when no password is configured', async () => {
      delete process.env.SOTTO_ACCESS_PASSWORD;
      const res = await POST(gateRequest({ password: 'anything' }));
      expect(res.status).toBe(404);
    });
  });

  describe('GET /invite', () => {
    it('opens the gate for a valid invite token and lands on the picker', async () => {
      const token = await createInviteToken();
      const res = await redeemInvite(new NextRequest(`http://localhost:3000/invite?t=${token}`));

      expect(new URL(res.headers.get('location')!).pathname).toBe('/profiles');
      expect(await verifyGateToken(res.cookies.get('sotto_gate')?.value)).toBe(true);
    });

    it('sends invalid or missing tokens to /gate without a cookie', async () => {
      for (const url of [
        'http://localhost:3000/invite',
        'http://localhost:3000/invite?t=123.deadbeef',
      ]) {
        const res = await redeemInvite(new NextRequest(url));
        expect(new URL(res.headers.get('location')!).pathname).toBe('/gate');
        expect(res.cookies.get('sotto_gate')).toBeUndefined();
      }
    });
  });
});
