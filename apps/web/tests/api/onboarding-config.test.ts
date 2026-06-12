/**
 * GET /api/v1/onboarding/config — tells the welcome flow whether it should run
 * as persisted self-hosted setup or as the public, non-persisting hosted demo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuth = vi.fn();
const mockRequireAdmin = vi.fn();
const mockGetSiteConfig = vi.fn();
const mockIsSelfHosted = vi.fn();

vi.mock('@/lib/auth', () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock('@/lib/auth-guards', () => ({
  requireAdmin: (...a: unknown[]) => mockRequireAdmin(...a),
}));
vi.mock('@/lib/site-config', () => ({
  getSiteConfig: (...a: unknown[]) => mockGetSiteConfig(...a),
}));
vi.mock('@/lib/self-hosted', () => ({
  isSelfHosted: (...a: unknown[]) => mockIsSelfHosted(...a),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET } from '@/app/api/v1/onboarding/config/route';

const SITE_CONFIG = {
  aiProvider: 'local',
  aiModel: 'qwen3',
  aiBaseUrl: 'http://localhost:11434',
  sttProvider: 'local',
  sttBaseUrl: 'http://localhost:8000/v1',
  sttModel: 'whisper-large',
  ttsProvider: 'kokoro',
  ttsBaseUrl: 'http://localhost:8000',
  storageProvider: 'local',
  s3Bucket: null,
  s3Region: null,
};

describe('GET /api/v1/onboarding/config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsSelfHosted.mockReturnValue(true);
    mockAuth.mockResolvedValue({ user: { id: 'u1' } });
    mockRequireAdmin.mockResolvedValue(null);
    mockGetSiteConfig.mockResolvedValue(SITE_CONFIG);
  });

  it('returns the public demo config without auth on the managed showcase', async () => {
    mockIsSelfHosted.mockReturnValue(false);
    mockAuth.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ selfHosted: false, isOwner: false, infra: null });
    expect(mockAuth).not.toHaveBeenCalled();
    expect(mockGetSiteConfig).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated self-hosted requests', async () => {
    mockAuth.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(mockGetSiteConfig).not.toHaveBeenCalled();
  });

  it('returns self-hosted non-owner config without infra', async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ selfHosted: true, isOwner: false, infra: null });
  });

  it('returns non-secret infra for the self-hosted owner', async () => {
    mockRequireAdmin.mockResolvedValue('u1');

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      selfHosted: true,
      isOwner: true,
      infra: SITE_CONFIG,
    });
  });
});
