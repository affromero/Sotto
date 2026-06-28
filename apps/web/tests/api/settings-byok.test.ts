import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockListByokProviders = vi.fn();
const mockStoreByokKey = vi.fn();
const mockRemoveByokKey = vi.fn();
const mockValidateByokKey = vi.fn();
const mockUpdateByokExtraData = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/byok', () => ({
  listByokProviders: (...args: unknown[]) => mockListByokProviders(...args),
  storeByokKey: (...args: unknown[]) => mockStoreByokKey(...args),
  removeByokKey: (...args: unknown[]) => mockRemoveByokKey(...args),
  validateByokKey: (...args: unknown[]) => mockValidateByokKey(...args),
  updateByokExtraData: (...args: unknown[]) => mockUpdateByokExtraData(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET, POST, DELETE } from '@/app/api/v1/settings/byok/route';

function createRequest(method: string, body?: object): NextRequest {
  const url = new URL('http://localhost:3000/api/v1/settings/byok');
  const init: { method: string; body?: string; headers?: Record<string, string> } = { method };
  if (body) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return new NextRequest(url, init);
}

describe('GET /api/v1/settings/byok', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await GET(createRequest('GET'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns list of BYOK providers', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    const keys = [{ provider: 'elevenlabs', isValid: true }];
    mockListByokProviders.mockResolvedValue(keys);

    const response = await GET(createRequest('GET'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ keys });
  });
});

describe('POST /api/v1/settings/byok', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await POST(
      createRequest('POST', { provider: 'elevenlabs', apiKey: 'sk-test-123456' })
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 400 when provider is invalid', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });

    const response = await POST(
      createRequest('POST', { provider: 'bad-provider', apiKey: 'sk-test-123456' })
    );
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

    const response = await POST(
      createRequest('POST', { provider: 'elevenlabs', apiKey: 'sk-eleven-test-123456' })
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toBeTruthy();
  });

  it('stores key and returns success when valid', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockValidateByokKey.mockResolvedValue(true);
    mockStoreByokKey.mockResolvedValue(undefined);

    const response = await POST(
      createRequest('POST', { provider: 'elevenlabs', apiKey: 'sk-eleven-test-123456' })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(mockStoreByokKey).toHaveBeenCalledWith('user-1', 'elevenlabs', {
      apiKey: 'sk-eleven-test-123456',
      userId: undefined,
      extra: {},
    });
  });

  it('stores optional Cartesia usage metadata with the provider key', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockValidateByokKey.mockResolvedValue(true);
    mockStoreByokKey.mockResolvedValue(undefined);

    const response = await POST(
      createRequest('POST', {
        provider: 'cartesia',
        apiKey: 'sk-car-test-123456',
        adminApiKey: 'sk-car-admin-test-123456',
        usagePlan: 'pro',
        monthlyCreditLimit: '1000000',
        billingResetDay: '1',
      })
    );

    expect(response.status).toBe(200);
    expect(mockStoreByokKey).toHaveBeenCalledWith('user-1', 'cartesia', {
      apiKey: 'sk-car-test-123456',
      userId: undefined,
      extra: {
        adminApiKey: 'sk-car-admin-test-123456',
        usagePlan: 'pro',
        monthlyCreditLimit: '1000000',
        billingResetDay: '1',
      },
    });
  });

  it('updates Cartesia usage metadata without replacing an existing provider key', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockUpdateByokExtraData.mockResolvedValue(true);

    const response = await POST(
      createRequest('POST', {
        provider: 'cartesia',
        adminApiKey: 'sk-car-admin-test-123456',
        usagePlan: 'pro',
        monthlyCreditLimit: '1000000',
        billingResetDay: '1',
      })
    );

    expect(response.status).toBe(200);
    expect(mockValidateByokKey).not.toHaveBeenCalled();
    expect(mockStoreByokKey).not.toHaveBeenCalled();
    expect(mockUpdateByokExtraData).toHaveBeenCalledWith('user-1', 'cartesia', {
      adminApiKey: 'sk-car-admin-test-123456',
      usagePlan: 'pro',
      monthlyCreditLimit: '1000000',
      billingResetDay: '1',
    });
  });

  it('clears a stored custom Cartesia limit when switching to a plan preset', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockUpdateByokExtraData.mockResolvedValue(true);

    const response = await POST(
      createRequest('POST', {
        provider: 'cartesia',
        usagePlan: 'free',
      })
    );

    expect(response.status).toBe(200);
    expect(mockUpdateByokExtraData).toHaveBeenCalledWith('user-1', 'cartesia', {
      usagePlan: 'free',
      monthlyCreditLimit: null,
    });
  });

  it('requires an existing key before saving metadata only', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockUpdateByokExtraData.mockResolvedValue(false);

    const response = await POST(
      createRequest('POST', {
        provider: 'cartesia',
        adminApiKey: 'sk-car-admin-test-123456',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toContain('Add a cartesia API key');
  });
});

describe('DELETE /api/v1/settings/byok', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await DELETE(createRequest('DELETE', { provider: 'elevenlabs' }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('requires an explicit provider', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockRemoveByokKey.mockResolvedValue(undefined);

    const url = new URL('http://localhost:3000/api/v1/settings/byok');
    const request = new NextRequest(url, { method: 'DELETE' });
    const response = await DELETE(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: 'Provider is required' });
    expect(mockRemoveByokKey).not.toHaveBeenCalled();
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

  it('rejects unknown provider', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockRemoveByokKey.mockResolvedValue(undefined);

    const response = await DELETE(createRequest('DELETE', { provider: 'unknown' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: 'Invalid request' });
    expect(mockRemoveByokKey).not.toHaveBeenCalled();
  });
});
