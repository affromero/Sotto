import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockListAiProviders = vi.fn();
const mockStoreAiKey = vi.fn();
const mockRemoveAiKey = vi.fn();
const mockValidateAiKey = vi.fn();
const mockIsValidAiProviderId = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/byok', () => ({
  listAiProviders: (...args: unknown[]) => mockListAiProviders(...args),
  storeAiKey: (...args: unknown[]) => mockStoreAiKey(...args),
  removeAiKey: (...args: unknown[]) => mockRemoveAiKey(...args),
  validateAiKey: (...args: unknown[]) => mockValidateAiKey(...args),
}));

vi.mock('@/lib/providers/ai-registry', () => ({
  isValidAiProviderId: (...args: unknown[]) => mockIsValidAiProviderId(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET, POST, DELETE } from '@/app/api/settings/ai-keys/route';

function createRequest(method: string, body?: object): NextRequest {
  const url = new URL('http://localhost:3000/api/settings/ai-keys');
  const init: { method: string; body?: string; headers?: Record<string, string> } = { method };
  if (body) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return new NextRequest(url, init);
}

describe('GET /api/settings/ai-keys', () => {
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

  it('returns list of AI keys', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    const keys = [{ provider: 'anthropic', isValid: true }];
    mockListAiProviders.mockResolvedValue(keys);

    const response = await GET(createRequest('GET'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ keys });
  });
});

describe('POST /api/settings/ai-keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await POST(createRequest('POST', { provider: 'anthropic', apiKey: 'sk-test-123456' }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 400 when provider is invalid', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockIsValidAiProviderId.mockReturnValue(false);

    const response = await POST(createRequest('POST', { provider: 'bad', apiKey: 'sk-test-123456' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid provider' });
  });

  it('returns 400 when apiKey is too short', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockIsValidAiProviderId.mockReturnValue(true);

    const response = await POST(createRequest('POST', { provider: 'anthropic', apiKey: 'short' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid API key' });
  });

  it('returns 422 when key validation fails', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockIsValidAiProviderId.mockReturnValue(true);
    mockValidateAiKey.mockResolvedValue(false);

    const response = await POST(createRequest('POST', { provider: 'anthropic', apiKey: 'sk-ant-test-123456789' }));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(typeof body.error).toBe('string');
  });

  it('stores key and returns success when valid', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockIsValidAiProviderId.mockReturnValue(true);
    mockValidateAiKey.mockResolvedValue(true);
    mockStoreAiKey.mockResolvedValue(undefined);

    const response = await POST(createRequest('POST', { provider: 'anthropic', apiKey: 'sk-ant-test-123456789' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
  });
});

describe('DELETE /api/settings/ai-keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await DELETE(createRequest('DELETE', { provider: 'anthropic' }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 400 when no body provided', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });

    const url = new URL('http://localhost:3000/api/settings/ai-keys');
    const request = new NextRequest(url, { method: 'DELETE' });
    const response = await DELETE(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Provider required' });
  });

  it('returns 400 when provider is invalid', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockIsValidAiProviderId.mockReturnValue(false);

    const response = await DELETE(createRequest('DELETE', { provider: 'bad-provider' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid provider' });
  });

  it('removes key and returns success', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockIsValidAiProviderId.mockReturnValue(true);
    mockRemoveAiKey.mockResolvedValue(undefined);

    const response = await DELETE(createRequest('DELETE', { provider: 'anthropic' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
  });
});
