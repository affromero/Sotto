import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock auth-guards
const mockRequireAdmin = vi.fn();
vi.mock('@/lib/auth-guards', () => ({
  requireAdmin: () => mockRequireAdmin(),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

async function getRoute() {
  const mod = await import('@/app/api/admin/kittentts/health/route');
  return mod.GET;
}

describe('GET /api/admin/kittentts/health', () => {
  let GET: Awaited<ReturnType<typeof getRoute>>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    GET = await getRoute();
  });

  afterEach(() => {
    delete process.env.KITTENTTS_URL;
  });

  describe('auth', () => {
    it('returns 403 when not an admin', async () => {
      mockRequireAdmin.mockResolvedValue(null);
      process.env.KITTENTTS_URL = 'http://localhost:8100';

      const res = await GET();
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body).toMatchObject({ error: 'Forbidden' });
    });
  });

  describe('unconfigured', () => {
    it('returns configured:false when KITTENTTS_URL is not set', async () => {
      mockRequireAdmin.mockResolvedValue('admin-1');
      delete process.env.KITTENTTS_URL;

      const res = await GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ configured: false, status: 'unconfigured' });
    });
  });

  describe('unavailable', () => {
    it('returns status:unavailable when fetch throws (service down)', async () => {
      mockRequireAdmin.mockResolvedValue('admin-1');
      process.env.KITTENTTS_URL = 'http://localhost:8100';
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const res = await GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.configured).toBe(true);
      expect(body.status).toBe('unavailable');
      expect(typeof body.latencyMs).toBe('number');
    });
  });

  describe('loading', () => {
    it('returns status:loading when /health responds with non-200', async () => {
      mockRequireAdmin.mockResolvedValue('admin-1');
      process.env.KITTENTTS_URL = 'http://localhost:8100';
      mockFetch.mockResolvedValue({ ok: false });

      const res = await GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.configured).toBe(true);
      expect(body.status).toBe('loading');
      expect(typeof body.latencyMs).toBe('number');
    });
  });

  describe('ready', () => {
    it('returns status and model from the health endpoint when service is ready', async () => {
      mockRequireAdmin.mockResolvedValue('admin-1');
      process.env.KITTENTTS_URL = 'http://localhost:8100';
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'ok', model: 'kitten-tts-nano-0.1' }),
      });

      const res = await GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.configured).toBe(true);
      expect(body.status).toBe('ok');
      expect(body.model).toBe('kitten-tts-nano-0.1');
      expect(typeof body.latencyMs).toBe('number');
    });

    it('returns latencyMs as a non-negative number', async () => {
      mockRequireAdmin.mockResolvedValue('admin-1');
      process.env.KITTENTTS_URL = 'http://localhost:8100';
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'ok' }),
      });

      const res = await GET();
      const body = await res.json();
      expect(body.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });
});
