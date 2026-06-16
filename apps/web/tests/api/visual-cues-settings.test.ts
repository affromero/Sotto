import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockListVisualCueKeys = vi.fn();
const mockStoreVisualCueKey = vi.fn();
const mockRemoveVisualCueKey = vi.fn();
const mockValidateVisualCueKey = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...a: unknown[]) => mockAuthenticateRequest(...a),
}));
vi.mock('@/lib/visual-cue-keys', () => ({
  isValidVisualCueProviderId: (provider: string) => provider === 'pexels',
  listVisualCueKeys: (...a: unknown[]) => mockListVisualCueKeys(...a),
  storeVisualCueKey: (...a: unknown[]) => mockStoreVisualCueKey(...a),
  removeVisualCueKey: (...a: unknown[]) => mockRemoveVisualCueKey(...a),
  validateVisualCueKey: (...a: unknown[]) => mockValidateVisualCueKey(...a),
}));

import {
  DELETE,
  GET,
  POST,
} from '@/app/api/v1/settings/visual-cues/route';

function req(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/v1/settings/visual-cues', {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
  mockValidateVisualCueKey.mockResolvedValue(true);
});

describe('/api/v1/settings/visual-cues', () => {
  it('lists configured visual cue providers', async () => {
    mockListVisualCueKeys.mockResolvedValue([{ provider: 'pexels', isValid: true }]);

    const res = await GET(req('GET'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ keys: [{ provider: 'pexels', isValid: true }] });
    expect(mockListVisualCueKeys).toHaveBeenCalledWith('u1');
  });

  it('validates and stores a Pexels key', async () => {
    const res = await POST(req('POST', { provider: 'pexels', apiKey: 'pexels_key_123' }));

    expect(res.status).toBe(200);
    expect(mockValidateVisualCueKey).toHaveBeenCalledWith('pexels', 'pexels_key_123');
    expect(mockStoreVisualCueKey).toHaveBeenCalledWith('u1', 'pexels', 'pexels_key_123');
  });

  it('rejects invalid visual cue credentials', async () => {
    mockValidateVisualCueKey.mockResolvedValue(false);

    const res = await POST(req('POST', { provider: 'pexels', apiKey: 'pexels_key_123' }));

    expect(res.status).toBe(422);
    expect(mockStoreVisualCueKey).not.toHaveBeenCalled();
  });

  it('removes a visual cue key', async () => {
    const res = await DELETE(req('DELETE', { provider: 'pexels' }));

    expect(res.status).toBe(200);
    expect(mockRemoveVisualCueKey).toHaveBeenCalledWith('u1', 'pexels');
  });
});
