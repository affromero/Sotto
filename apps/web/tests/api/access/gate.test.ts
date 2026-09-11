import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockCheckRateLimit = vi.fn();
vi.mock('@/lib/redis', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

import { POST } from '@/app/api/v1/gate/route';
import { verifyGateToken } from '@/lib/access/gate';

const TEST_ACCESS_PASSWORD = 'test-access-password'; // gitleaks:allow
const TEST_SIGNING_KEY = 'test-signing-key-material-0123456789abcdef'; // gitleaks:allow

function gateRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/gate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('access gate routes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.SOTTO_ACCESS_PASSWORD = TEST_ACCESS_PASSWORD;
    process.env.BYOK_ENCRYPTION_KEY = TEST_SIGNING_KEY;
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
      const res = await POST(gateRequest({ password: TEST_ACCESS_PASSWORD }));

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

    it('returns a generic 429 when any anti-automation bucket is exhausted', async () => {
      mockCheckRateLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 30_000,
      });

      const res = await POST(gateRequest({ password: TEST_ACCESS_PASSWORD }));

      expect(res.status).toBe(429);
      await expect(res.json()).resolves.toEqual({
        error: 'Too many attempts. Try again later.',
      });
      expect(res.headers.get('Retry-After')).toBeNull();
    });

    it('rejects cross-site browser attempts before checking the password', async () => {
      const request = new NextRequest('http://localhost:3000/api/v1/gate', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'sec-fetch-site': 'cross-site',
        },
        body: JSON.stringify({ password: TEST_ACCESS_PASSWORD }),
      });

      const res = await POST(request);

      expect(res.status).toBe(403);
      expect(mockCheckRateLimit).not.toHaveBeenCalled();
    });

    it('limits password guesses even when clients rotate forwarded addresses', async () => {
      const buckets = new Map<string, { count: number; expiresAt: number }>();
      let now = Date.now();
      mockCheckRateLimit.mockImplementation(
        async (identifier: string, limit: number, windowSeconds: number) => {
          const previous = buckets.get(identifier);
          const bucket =
            previous && previous.expiresAt > now
              ? previous
              : { count: 0, expiresAt: now + windowSeconds * 1000 };
          const allowed = bucket.count < limit;
          if (allowed) bucket.count += 1;
          buckets.set(identifier, bucket);
          return {
            allowed,
            remaining: Math.max(0, limit - bucket.count),
            resetAt: bucket.expiresAt,
          };
        }
      );

      for (let attempt = 0; attempt < 60; attempt += 1) {
        const response = await POST(
          gateRequest(
            { password: 'wrong-password' },
            {
              'cf-connecting-ip': `192.0.2.${attempt}`,
              'x-real-ip': `198.51.100.${attempt}`,
              'x-forwarded-for': `203.0.113.${attempt}`,
            }
          )
        );
        expect(response.status).toBe(401);
      }

      const response = await POST(
        gateRequest(
          { password: TEST_ACCESS_PASSWORD },
          {
            'cf-connecting-ip': '192.0.2.200',
            'x-real-ip': '198.51.100.200',
            'x-forwarded-for': '203.0.113.200',
          }
        )
      );
      expect(response.status).toBe(429);
      expect(response.cookies.get('sotto_gate')).toBeUndefined();
      expect(response.headers.get('Cache-Control')).toBe('no-store');

      now += 15 * 60 * 1000;
      const recovered = await POST(gateRequest({ password: TEST_ACCESS_PASSWORD }));
      expect(recovered.status).toBe(200);
      expect(await verifyGateToken(recovered.cookies.get('sotto_gate')?.value)).toBe(true);
    });

    it('is 404 when no password is configured', async () => {
      delete process.env.SOTTO_ACCESS_PASSWORD;
      const res = await POST(gateRequest({ password: 'anything' }));
      expect(res.status).toBe(404);
    });
  });
});
