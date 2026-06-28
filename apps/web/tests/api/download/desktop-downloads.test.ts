import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/download/[platform]/route';

function request(path: string): NextRequest {
  return new NextRequest(new URL(path, 'https://sotto.fm'));
}

function params(platform: string) {
  return { params: Promise.resolve({ platform }) };
}

describe('desktop download redirects', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.R2_PUBLIC_URL = 'https://cdn.sotto.fm';
    delete process.env.DESKTOP_DOWNLOAD_BASE_URL;
    delete process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_BASE_URL;
    delete process.env.DESKTOP_GITHUB_RELEASE_BASE_URL;
    delete process.env.DESKTOP_LATEST_VERSION;
    delete process.env.NEXT_PUBLIC_DESKTOP_LATEST_VERSION;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.R2_PUBLIC_URL;
    delete process.env.DESKTOP_DOWNLOAD_BASE_URL;
    delete process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_BASE_URL;
    delete process.env.DESKTOP_GITHUB_RELEASE_BASE_URL;
    delete process.env.DESKTOP_LATEST_VERSION;
    delete process.env.NEXT_PUBLIC_DESKTOP_LATEST_VERSION;
  });

  it('redirects a platform download to the primary file from the latest manifest', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        version: 'v0.1',
        platform: 'mac',
        primary: { href: 'sotto-host-v0.1-mac.dmg', filename: 'sotto-host-v0.1-mac.dmg' },
      })
    );
    global.fetch = fetchMock;

    const response = await GET(request('/download/mac'), params('mac'));

    expect(fetchMock).toHaveBeenCalledWith(
      'https://cdn.sotto.fm/download/desktop/latest/mac/manifest.json',
      { next: { revalidate: 300 } }
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://cdn.sotto.fm/download/desktop/latest/mac/sotto-host-v0.1-mac.dmg'
    );
  });

  it('supports explicit release versions without requiring the v prefix', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        primary: { href: '/download/desktop/v0.1/windows/sotto-host-v0.1-windows.msi' },
      })
    );
    global.fetch = fetchMock;

    const response = await GET(request('/download/windows?version=0.1'), params('windows'));

    expect(fetchMock).toHaveBeenCalledWith(
      'https://cdn.sotto.fm/download/desktop/v0.1/windows/manifest.json',
      { next: { revalidate: 300 } }
    );
    expect(response.headers.get('location')).toBe(
      'https://cdn.sotto.fm/download/desktop/v0.1/windows/sotto-host-v0.1-windows.msi'
    );
  });

  it('falls back to the GitHub release asset when a CDN manifest is missing', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));

    const response = await GET(request('/download/linux'), params('linux'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://github.com/affromero/Sotto/releases/download/v0.1/sotto-host-v0.1-linux.AppImage'
    );
  });

  it('falls back to GitHub release downloads when CDN downloads are not configured', async () => {
    delete process.env.R2_PUBLIC_URL;
    const fetchMock = vi.fn();
    global.fetch = fetchMock;

    const response = await GET(request('/download/windows?version=0.1'), params('windows'));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://github.com/affromero/Sotto/releases/download/v0.1/sotto-host-v0.1-windows.msi'
    );
  });

  it('rejects unsupported platforms', async () => {
    const response = await GET(request('/download/freebsd'), params('freebsd'));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Unsupported desktop platform.' });
  });
});
