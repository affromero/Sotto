import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockQueryRaw = vi.fn();
const mockPing = vi.fn();
const mockLlen = vi.fn();
const mockZcard = vi.fn();
const mockS3Send = vi.fn();
const mockAuth = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
}));

vi.mock('@/lib/redis', () => ({
  getRedisClient: () => ({
    ping: () => mockPing(),
    llen: (...args: unknown[]) => mockLlen(...args),
    zcard: (...args: unknown[]) => mockZcard(...args),
  }),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class MockS3Client {
    send(...args: unknown[]) {
      return mockS3Send(...args);
    }
  },
  HeadBucketCommand: class MockHeadBucketCommand {
    constructor(public opts: unknown) {}
  },
}));

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

import { GET } from '@/app/api/health/route';

describe('GET /api/health', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    originalFetch = globalThis.fetch;
    // Default: DB and Redis succeed, queues have no failures, S3 reachable
    mockQueryRaw.mockResolvedValue([{ ok: 1 }]);
    mockPing.mockResolvedValue('PONG');
    mockLlen.mockResolvedValue(0);
    mockZcard.mockResolvedValue(0);
    mockS3Send.mockResolvedValue({});
    // Default: admin session for detailed checks
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    // Default: mock fetch so tests are isolated from real external API calls
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    globalThis.fetch = originalFetch;
  });

  it('returns checks but no env for unauthenticated requests', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('healthy');
    expect(body.timestamp).toBeDefined();
    expect(body.checks).toBeDefined();
    expect(body.checks.database.status).toBe('ok');
    expect(body.env).toBeUndefined();
    expect(body.version).toBeDefined();
    expect(body.oauth).toBeDefined();
    expect(body.vapid).toBeDefined();
  });

  it('returns checks but no env for non-admin users', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'USER' } });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('healthy');
    expect(body.checks).toBeDefined();
    expect(body.checks.database.status).toBe('ok');
    expect(body.env).toBeUndefined();
    expect(body.oauth).toBeDefined();
  });

  it('returns 200 healthy when DB and Redis pass', async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('healthy');
    expect(body.checks.database.status).toBe('ok');
    expect(body.checks.redis.status).toBe('ok');
    expect(body.checks.database.latencyMs).toBeTypeOf('number');
    expect(body.checks.redis.latencyMs).toBeTypeOf('number');
  });

  it('returns 503 degraded when DB fails', async () => {
    mockQueryRaw.mockRejectedValue(new Error('Connection refused'));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.checks.database.status).toBe('error');
  });

  it('returns 503 degraded when Redis fails', async () => {
    mockPing.mockRejectedValue(new Error('ECONNREFUSED'));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.checks.redis.status).toBe('error');
  });

  it('returns degraded with checks for non-admin when DB fails', async () => {
    mockAuth.mockResolvedValue(null);
    mockQueryRaw.mockRejectedValue(new Error('Connection refused'));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.checks.database.status).toBe('error');
    expect(body.env).toBeUndefined();
  });

  it('reports storage not_configured when R2 env vars are missing', async () => {
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;

    const response = await GET();
    const body = await response.json();

    expect(body.checks.storage.status).toBe('not_configured');
  });

  it('reports storage ok when R2 is configured and reachable', async () => {
    process.env.R2_ACCOUNT_ID = 'test-account';
    process.env.R2_ACCESS_KEY_ID = 'test-key';
    process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
    mockS3Send.mockResolvedValue({});

    const response = await GET();
    const body = await response.json();

    expect(body.checks.storage.status).toBe('ok');
  });

  it('reports storage error when R2 HeadBucket fails', async () => {
    process.env.R2_ACCOUNT_ID = 'test-account';
    process.env.R2_ACCESS_KEY_ID = 'test-key';
    process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
    mockS3Send.mockRejectedValue(new Error('Access denied'));

    const response = await GET();
    const body = await response.json();

    expect(body.checks.storage.status).toBe('error');
  });

  it('reports anthropic not_configured when key is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const response = await GET();
    const body = await response.json();

    expect(body.checks.anthropic.status).toBe('not_configured');
  });

  it('reports anthropic error when API returns non-ok', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });

    const response = await GET();
    const body = await response.json();

    expect(body.checks.anthropic.status).toBe('error');
    expect(body.checks.anthropic.detail).toContain('401');
  });

  it('reports anthropic ok when API returns ok', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const response = await GET();
    const body = await response.json();

    expect(body.checks.anthropic.status).toBe('ok');
    expect(body.checks.anthropic.latencyMs).toBeTypeOf('number');
  });

  it('reports openai not_configured when key is missing', async () => {
    delete process.env.OPENAI_API_KEY;

    const response = await GET();
    const body = await response.json();

    expect(body.checks.openai.status).toBe('not_configured');
  });

  it('reports openai ok when API returns ok', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const response = await GET();
    const body = await response.json();

    expect(body.checks.openai.status).toBe('ok');
    expect(body.checks.openai.latencyMs).toBeTypeOf('number');
  });

  it('reports openai error when API returns non-ok', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });

    const response = await GET();
    const body = await response.json();

    expect(body.checks.openai.status).toBe('error');
    expect(body.checks.openai.detail).toContain('401');
  });

  it('reports elevenlabs not_configured when key is missing', async () => {
    delete process.env.ELEVENLABS_API_KEY;

    const response = await GET();
    const body = await response.json();

    expect(body.checks.elevenlabs.status).toBe('not_configured');
  });

  it('reports elevenlabs error when API returns non-ok', async () => {
    process.env.ELEVENLABS_API_KEY = 'xi-test';
    delete process.env.ANTHROPIC_API_KEY;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });

    const response = await GET();
    const body = await response.json();

    expect(body.checks.elevenlabs.status).toBe('error');
    expect(body.checks.elevenlabs.detail).toContain('403');
  });

  it('handles fetch timeout gracefully for anthropic', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    delete process.env.ELEVENLABS_API_KEY;
    globalThis.fetch = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'));

    const response = await GET();
    const body = await response.json();

    expect(body.checks.anthropic.status).toBe('error');
  });

  it('reports queues degraded when >50 failed jobs', async () => {
    // 12 queues, ~5 failed each = 60 total > 50
    mockZcard.mockResolvedValue(5);

    const response = await GET();
    const body = await response.json();

    expect(body.checks.queues.status).toBe('degraded');
  });

  it('reports queues ok when failed jobs are under threshold', async () => {
    mockZcard.mockResolvedValue(0);

    const response = await GET();
    const body = await response.json();

    expect(body.checks.queues.status).toBe('ok');
  });

  it('includes env var map in response', async () => {
    process.env.DATABASE_URL = 'postgresql://test';
    process.env.NEXTAUTH_SECRET = 'secret';
    delete process.env.ANTHROPIC_API_KEY;

    const response = await GET();
    const body = await response.json();

    expect(body.env.DATABASE_URL).toBe(true);
    expect(body.env.NEXTAUTH_SECRET).toBe(true);
    expect(body.env.ANTHROPIC_API_KEY).toBe(false);
  });

  it('includes oauth provider map in response', async () => {
    process.env.GOOGLE_CLIENT_ID = 'g-id';
    process.env.GOOGLE_CLIENT_SECRET = 'g-secret';
    delete process.env.APPLE_CLIENT_ID;

    const response = await GET();
    const body = await response.json();

    expect(body.oauth.google).toBe(true);
    expect(body.oauth.apple).toBe(false);
  });

  it('includes vapid flag in response', async () => {
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;

    const response = await GET();
    const body = await response.json();

    expect(body.vapid).toBe(false);
  });

  it('includes timestamp and version', async () => {
    const response = await GET();
    const body = await response.json();

    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.version).toBeDefined();
  });
});
