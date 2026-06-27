/**
 * Device pairing routes — issue (auth-gated) + redeem (token-as-credential).
 * The redeem route turns a valid pairing token into a long-lived API key, and
 * must fail closed on an invalid/expired/used token.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
vi.mock('@/lib/auth', () => ({ auth: () => mockAuth() }));

const mockCreatePairingToken = vi.fn();
const mockRedeemPairingToken = vi.fn();
const mockDetectTailscaleServeUrl = vi.fn();
vi.mock('@/lib/pairing', () => ({
  createPairingToken: (...a: unknown[]) => mockCreatePairingToken(...a),
  redeemPairingToken: (...a: unknown[]) => mockRedeemPairingToken(...a),
}));
vi.mock('@/lib/tailscale-reach', () => ({
  detectTailscaleServeUrl: (...a: unknown[]) => mockDetectTailscaleServeUrl(...a),
}));

const mockApiKeyCreate = vi.fn();
const mockUserFindUnique = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    apiKey: { create: (...a: unknown[]) => mockApiKeyCreate(...a) },
    user: { findUnique: (...a: unknown[]) => mockUserFindUnique(...a) },
  },
}));

vi.mock('@/lib/api-keys', () => ({
  generateApiKey: () => ({ key: 'sk_sotto_paired', hash: 'h', prefix: 'sk_sotto_pa' }),
}));

vi.mock('@/lib/api-response', () => ({
  errorResponse: (message: unknown, status: number) =>
    new Response(JSON.stringify({ error: message }), { status }),
}));

function postReq(path: string, body: unknown): NextRequest {
  return new NextRequest(new URL(`https://sotto.example${path}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/auth/pair (issue)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDetectTailscaleServeUrl.mockResolvedValue(null);
  });

  it('rejects an unauthenticated request with 401', async () => {
    mockAuth.mockResolvedValue(null);
    const { POST } = await import('@/app/api/v1/auth/pair/route');
    const res = await POST(postReq('/api/v1/auth/pair', {}));
    expect(res.status).toBe(401);
    expect(mockCreatePairingToken).not.toHaveBeenCalled();
  });

  it('issues a token + connect URL for the signed-in learner', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCreatePairingToken.mockResolvedValue({
      token: 'rawtok',
      expiresAt: new Date('2030-01-01T00:00:00Z'),
    });
    const { POST } = await import('@/app/api/v1/auth/pair/route');
    const res = await POST(postReq('/api/v1/auth/pair', { name: 'My iPad' }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.token).toBe('rawtok');
    expect(json.serverUrl).toBe('https://sotto.example');
    expect(json.connectUrl).toBe('https://sotto.example/connect?token=rawtok');
    expect(mockCreatePairingToken).toHaveBeenCalledWith('user-1', 'My iPad');
  });

  it('uses an explicit reach URL for Tailscale pairing links', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCreatePairingToken.mockResolvedValue({
      token: 'rawtok',
      expiresAt: new Date('2030-01-01T00:00:00Z'),
    });
    const { POST } = await import('@/app/api/v1/auth/pair/route');
    const res = await POST(
      postReq('/api/v1/auth/pair', { reachUrl: 'https://sotto.tailnet.ts.net/' })
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.serverUrl).toBe('https://sotto.tailnet.ts.net');
    expect(json.connectUrl).toBe('https://sotto.tailnet.ts.net/connect?token=rawtok');
  });

  it('uses a detected Tailscale Serve URL when no reach URL is provided', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockDetectTailscaleServeUrl.mockResolvedValue('https://andres-macbook-pro.tail297718.ts.net');
    mockCreatePairingToken.mockResolvedValue({
      token: 'rawtok',
      expiresAt: new Date('2030-01-01T00:00:00Z'),
    });
    const { POST } = await import('@/app/api/v1/auth/pair/route');
    const res = await POST(postReq('/api/v1/auth/pair', {}));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.serverUrl).toBe('https://andres-macbook-pro.tail297718.ts.net');
    expect(json.connectUrl).toBe(
      'https://andres-macbook-pro.tail297718.ts.net/connect?token=rawtok'
    );
  });
});

describe('POST /api/v1/auth/pair/redeem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDetectTailscaleServeUrl.mockResolvedValue(null);
  });

  it('mints an API key for a valid token', async () => {
    mockRedeemPairingToken.mockResolvedValue({ userId: 'user-1', name: 'iPad' });
    mockUserFindUnique.mockResolvedValue({
      id: 'user-1',
      name: 'A',
      email: 'a@x.co',
      handle: null,
      image: null,
      role: 'USER',
    });
    const { POST } = await import('@/app/api/v1/auth/pair/redeem/route');
    const res = await POST(postReq('/api/v1/auth/pair/redeem', { token: 'rawtoken123' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.token).toBe('sk_sotto_paired');
    expect(json.user.id).toBe('user-1');
    expect(mockApiKeyCreate).toHaveBeenCalledWith({
      data: { userId: 'user-1', name: 'iPad', keyHash: 'h', keyPrefix: 'sk_sotto_pa' },
    });
  });

  it('rejects an invalid/expired/used token with 401 and mints nothing', async () => {
    mockRedeemPairingToken.mockResolvedValue(null);
    const { POST } = await import('@/app/api/v1/auth/pair/redeem/route');
    const res = await POST(postReq('/api/v1/auth/pair/redeem', { token: 'badtoken123' }));
    expect(res.status).toBe(401);
    expect(mockApiKeyCreate).not.toHaveBeenCalled();
  });

  it('rejects a malformed body with 400', async () => {
    const { POST } = await import('@/app/api/v1/auth/pair/redeem/route');
    const res = await POST(postReq('/api/v1/auth/pair/redeem', { token: 'x' }));
    expect(res.status).toBe(400);
    expect(mockRedeemPairingToken).not.toHaveBeenCalled();
  });
});
