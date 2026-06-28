import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetSharedByokKey = vi.fn();
const mockGetByokExtraData = vi.fn();
const mockGetSharedAdminByokExtraData = vi.fn();

vi.mock('@/lib/byok', () => ({
  getSharedByokKey: (...args: unknown[]) => mockGetSharedByokKey(...args),
  getByokExtraData: (...args: unknown[]) => mockGetByokExtraData(...args),
  getSharedAdminByokExtraData: (...args: unknown[]) => mockGetSharedAdminByokExtraData(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  getCartesiaUsageProvider,
  resetCartesiaUsageCacheForTests,
  resolveCartesiaUsageAllowance,
} from '@/lib/agent-usage/providers/cartesia';

describe('getCartesiaUsageProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    resetCartesiaUsageCacheForTests();
  });

  it('resolves monthly allowance from a provider plan preset', () => {
    expect(resolveCartesiaUsageAllowance({ usagePlan: 'startup' })).toEqual({
      monthlyLimit: 1_250_000,
      planId: 'startup',
      planLabel: 'Startup',
    });
  });

  it('uses the owner Cartesia admin key when a learner has only a generation key', async () => {
    mockGetSharedByokKey.mockResolvedValue({
      apiKey: 'sk-car-learner',
      ownerUserId: 'learner-1',
      shared: false,
    });
    mockGetByokExtraData.mockResolvedValue(null);
    mockGetSharedAdminByokExtraData.mockResolvedValue({
      adminApiKey: 'sk-car-admin',
      monthlyCreditLimit: '10000',
    });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: [{ credits: 1200 }] })));

    const provider = await getCartesiaUsageProvider({ userId: 'learner-1' });

    expect(provider).toMatchObject({
      id: 'cartesia',
      status: 'ready',
      credits: { label: '8,800 credits left' },
    });
    expect(mockGetSharedAdminByokExtraData).toHaveBeenCalledWith('learner-1', 'cartesia');
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer sk-car-admin',
    });

    fetchMock.mockRestore();
  });

  it('uses env Cartesia admin settings for platform-key installs', async () => {
    vi.stubEnv('CARTESIA_API_KEY', 'sk-car-env');
    vi.stubEnv('CARTESIA_ADMIN_API_KEY', 'sk-car-admin-env');
    vi.stubEnv('CARTESIA_USAGE_PLAN', 'free');
    mockGetSharedByokKey.mockResolvedValue(null);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: [{ credits: 518 }] })));

    const provider = await getCartesiaUsageProvider({ userId: 'owner-1' });

    expect(provider).toMatchObject({
      id: 'cartesia',
      planLabel: 'Free',
      status: 'ready',
      credits: { label: '19,482 credits left' },
    });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer sk-car-admin-env',
    });

    fetchMock.mockRestore();
  });
});
