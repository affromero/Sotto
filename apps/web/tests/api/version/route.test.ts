import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from '@/app/api/version/route';
import packageJson from '../../../package.json';

describe('GET /api/version', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.unstubAllEnvs();
    delete process.env.COMMIT_SHA;
    delete process.env.NEXT_PUBLIC_COMMIT_SHA;
    delete process.env.DESKTOP_LATEST_VERSION;
    delete process.env.NEXT_PUBLIC_DESKTOP_LATEST_VERSION;
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.NEXT_PUBLIC_GITHUB_REPOSITORY;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it('returns app, commit, release, and desktop download metadata', async () => {
    process.env.COMMIT_SHA = '6b2b9122';
    process.env.DESKTOP_LATEST_VERSION = '0.1';
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        tag_name: 'v0.1.0',
        html_url: 'https://github.com/affromero/Sotto/releases/tag/v0.1.0',
        published_at: '2026-06-28T12:00:00Z',
      })
    );
    global.fetch = fetchMock;

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/affromero/Sotto/releases/latest',
      {
        headers: { Accept: 'application/vnd.github+json' },
        next: { revalidate: 300 },
      }
    );
    expect(body).toMatchObject({
      current: packageJson.version,
      version: packageJson.version,
      commit: '6b2b9122',
      latest: {
        version: 'v0.1.0',
        url: 'https://github.com/affromero/Sotto/releases/tag/v0.1.0',
        publishedAt: '2026-06-28T12:00:00Z',
      },
      updateAvailable: false,
      desktop: {
        latest: 'v0.1.0',
        downloads: {
          mac: '/download/mac',
          windows: '/download/windows',
          linux: '/download/linux',
        },
      },
    });
  });

  it('reports update availability when the latest release is newer', async () => {
    process.env.NEXT_PUBLIC_COMMIT_SHA = 'abc1234';
    global.fetch = vi.fn().mockResolvedValue(
      Response.json({
        tag_name: 'v0.2.0',
      })
    );

    const response = await GET();
    const body = await response.json();

    expect(body.commit).toBe('abc1234');
    expect(body.latest).toMatchObject({ version: 'v0.2.0' });
    expect(body.updateAvailable).toBe(true);
  });

  it('keeps the endpoint useful when GitHub release lookup fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network unavailable'));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.current).toBe(packageJson.version);
    expect(body.commit).toBe('dev');
    expect(body.latest).toBeNull();
    expect(body.updateAvailable).toBe(false);
  });
});
