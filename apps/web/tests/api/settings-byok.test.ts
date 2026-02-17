import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockListByokProviders = vi.fn();
const mockStoreByokKey = vi.fn();
const mockRemoveByokKey = vi.fn();
const mockValidateByokKey = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/byok', () => ({
  listByokProviders: (...args: unknown[]) => mockListByokProviders(...args),
  storeByokKey: (...args: unknown[]) => mockStoreByokKey(...args),
  removeByokKey: (...args: unknown[]) => mockRemoveByokKey(...args),
  validateByokKey: (...args: unknown[]) => mockValidateByokKey(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET, POST, DELETE } from '@/app/api/settings/byok/route';

function createRequest(method: string, body?: object): NextRequest {
  const url = new URL('http://localhost:3000/api/settings/byok');
  const init: { method: string; body?: string; headers?: Record<string, string> } = { method };
  if (body) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return new NextRequest(url, init);
}

describe('GET /api/settings/byok', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await GET(createRequest('GET'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns list of BYOK providers', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    const keys = [{ provider: 'elevenlabs', isValid: true }];
    mockListByokProviders.mockResolvedValue(keys);

    const response = await GET(createRequest('GET'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ keys });
    expect(mockListByokProviders).toHaveBeenCalledWith('user-1');
  });
});

describe('POST /api/settings/byok', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await POST(createRequest('POST', { provider: 'elevenlabs', apiKey: 'sk-test-123456' }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 400 when provider is invalid', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });

    const response = await POST(createRequest('POST', { provider: 'bad-provider', apiKey: 'sk-test-123456' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid request');
  });

  it('returns 400 when apiKey is too short', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });

    const response = await POST(createRequest('POST', { provider: 'elevenlabs', apiKey: 'short' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid request');
  });

  it('returns 422 when key validation fails', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockValidateByokKey.mockResolvedValue(false);

    const response = await POST(createRequest('POST', { provider: 'elevenlabs', apiKey: 'sk-eleven-test-123456' }));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toContain('Invalid elevenlabs credentials');
  });

  it('stores key and returns success when valid', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockValidateByokKey.mockResolvedValue(true);
    mockStoreByokKey.mockResolvedValue(undefined);

    const response = await POST(createRequest('POST', { provider: 'elevenlabs', apiKey: 'sk-eleven-test-123456' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(mockStoreByokKey).toHaveBeenCalledWith('user-1', 'elevenlabs', {
      apiKey: 'sk-eleven-test-123456',
      userId: undefined,
    });
  });
});

describe('DELETE /api/settings/byok', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await DELETE(createRequest('DELETE', { provider: 'elevenlabs' }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('defaults to elevenlabs when no body provided', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockRemoveByokKey.mockResolvedValue(undefined);

    const url = new URL('http://localhost:3000/api/settings/byok');
    const request = new NextRequest(url, { method: 'DELETE' });
    const response = await DELETE(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(mockRemoveByokKey).toHaveBeenCalledWith('user-1', 'elevenlabs');
  });

  it('removes specific provider key', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockRemoveByokKey.mockResolvedValue(undefined);

    const response = await DELETE(createRequest('DELETE', { provider: 'openai' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(mockRemoveByokKey).toHaveBeenCalledWith('user-1', 'openai');
  });

  it('defaults to elevenlabs for unknown provider', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockRemoveByokKey.mockResolvedValue(undefined);

    const response = await DELETE(createRequest('DELETE', { provider: 'unknown' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(mockRemoveByokKey).toHaveBeenCalledWith('user-1', 'elevenlabs');
  });
});
