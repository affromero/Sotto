/**
 * GET /api/v1/onboarding/config — tells the welcome flow whether it should run
 * as persisted self-hosted setup or as the public, non-persisting hosted demo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockIsUserAdmin = vi.fn();
const mockGetSiteConfig = vi.fn();
const mockIsSelfHosted = vi.fn();
const mockGetAgentStatus = vi.fn();

vi.mock('@/lib/auth', () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock('@/lib/auth-guards', () => ({
  isUserAdmin: (...a: unknown[]) => mockIsUserAdmin(...a),
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
vi.mock('@/lib/agent-availability', () => ({
  getAgentStatus: (...args: unknown[]) => mockGetAgentStatus(...args),
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

function req(): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/onboarding/config');
}

describe('GET /api/v1/onboarding/config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsSelfHosted.mockReturnValue(true);
    mockAuth.mockResolvedValue({ user: { id: 'u1' } });
    mockIsUserAdmin.mockResolvedValue(false);
    mockGetSiteConfig.mockResolvedValue(SITE_CONFIG);
    mockGetAgentStatus.mockImplementation(async (provider: string) => ({
      readiness: 'ready',
      version: `${provider} 1.0`,
      detail: null,
    }));
  });

  it('returns the public demo config without auth on the managed showcase', async () => {
    mockIsSelfHosted.mockReturnValue(false);
    mockAuth.mockResolvedValue(null);

    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ selfHosted: false, isOwner: false, infra: null, env: null });
    expect(mockAuth).not.toHaveBeenCalled();
    expect(mockGetSiteConfig).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated self-hosted requests', async () => {
    mockAuth.mockResolvedValue(null);

    const res = await GET(req());

    expect(res.status).toBe(401);
    expect(mockGetSiteConfig).not.toHaveBeenCalled();
  });

  it('returns self-hosted non-owner config without infra or env presence', async () => {
    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ selfHosted: true, isOwner: false, infra: null, env: null });
  });

  it('returns non-secret infra and env presence for the self-hosted owner', async () => {
    mockIsUserAdmin.mockResolvedValue(true);

    const res = await GET(req());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.selfHosted).toBe(true);
    expect(body.isOwner).toBe(true);
    expect(body.infra).toEqual(SITE_CONFIG);
    // Presence booleans/ids only — never values.
    expect(Array.isArray(body.env.tts)).toBe(true);
    expect(Array.isArray(body.env.stt)).toBe(true);
    expect(Array.isArray(body.env.ai)).toBe(true);
    expect(typeof body.env.storage.R2_ACCOUNT_ID).toBe('boolean');
    expect(body.agentStatuses.codex.readiness).toBe('ready');
    expect(JSON.stringify(body.env)).not.toContain('sk_');
  });

  describe('env presence detection', () => {
    const VARS = ['CARTESIA_API_KEY', 'ANTHROPIC_API_KEY', 'ASSEMBLYAI_API_KEY', 'R2_ACCOUNT_ID'];
    const saved: Record<string, string | undefined> = {};

    beforeEach(() => {
      mockIsUserAdmin.mockResolvedValue(true);
      for (const name of VARS) {
        saved[name] = process.env[name];
        delete process.env[name];
      }
    });

    afterEach(() => {
      for (const name of VARS) {
        if (saved[name] === undefined) delete process.env[name];
        else process.env[name] = saved[name];
      }
    });

    it('reports providers whose platform key is set, keyed by wizard ids', async () => {
      process.env.CARTESIA_API_KEY = 'sk_car_test';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      process.env.ASSEMBLYAI_API_KEY = 'aai-test';
      process.env.R2_ACCOUNT_ID = 'acct';

      const body = await (await GET(req())).json();

      expect(body.env.tts).toContain('cartesia');
      expect(body.env.stt).toContain('cartesia');
      // assemblyai env maps back to the wizard id "assembly".
      expect(body.env.stt).toContain('assembly');
      // ANTHROPIC_API_KEY backs the "claude" key method.
      expect(body.env.ai).toContain('claude');
      expect(body.env.storage.R2_ACCOUNT_ID).toBe(true);
    });

    it('omits providers whose key is absent', async () => {
      const body = await (await GET(req())).json();

      expect(body.env.tts).not.toContain('cartesia');
      expect(body.env.stt).not.toContain('assembly');
      expect(body.env.ai).not.toContain('claude');
      expect(body.env.storage.R2_ACCOUNT_ID).toBe(false);
    });
  });
});
