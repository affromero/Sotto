import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockCreateVoicePayment = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/voice-pricing', () => ({
  createVoicePayment: (...args: unknown[]) => mockCreateVoicePayment(...args),
}));

vi.mock('@/lib/stripe', () => ({
  stripe: {},
  LIMITS: { maxDurationMinutes: 40 },
  PLATFORM_FEE_PERCENT: 10,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { POST } from '@/app/api/stripe/payment-intent/route';

function createRequest(body: unknown): NextRequest {
  const url = new URL('http://localhost:3000/api/stripe/payment-intent');
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/stripe/payment-intent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest({ voiceCharges: [{ voiceCloneId: 'vc_1' }] });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 400 when voiceCharges is empty', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

    const request = createRequest({ voiceCharges: [] });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'voiceCharges is required' });
  });

  it('returns 400 when voiceCharges is missing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

    const request = createRequest({});
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'voiceCharges is required' });
  });

  it('creates payment intents for valid voice charges', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCreateVoicePayment.mockResolvedValue({
      clientSecret: 'cs_test_123',
      paymentIntentId: 'pi_test_123',
    });

    const request = createRequest({
      voiceCharges: [{ voiceCloneId: 'vc_1', podcastId: 'pod_1' }],
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.payments).toHaveLength(1);
    expect(body.payments[0]).toEqual({
      voiceCloneId: 'vc_1',
      clientSecret: 'cs_test_123',
      paymentIntentId: 'pi_test_123',
    });
    expect(body.paymentIntentIds).toEqual(['pi_test_123']);
    expect(mockCreateVoicePayment).toHaveBeenCalledWith('user-1', 'vc_1', 'pod_1');
  });

  it('uses placeholder podcastId when not provided', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCreateVoicePayment.mockResolvedValue({
      clientSecret: 'cs_test_456',
      paymentIntentId: 'pi_test_456',
    });

    const request = createRequest({
      voiceCharges: [{ voiceCloneId: 'vc_2' }],
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockCreateVoicePayment).toHaveBeenCalledWith('user-1', 'vc_2', 'pending');
  });
});
