import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { searchStockVideo, downloadStockAsset } from '@/lib/stock-footage';

const fetchSpy = vi.spyOn(globalThis, 'fetch');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.PEXELS_API_KEY;
});

describe('searchStockVideo', () => {
  it('returns null when PEXELS_API_KEY is not set', async () => {
    delete process.env.PEXELS_API_KEY;
    const result = await searchStockVideo('nature landscape');
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns a video result from Pexels', async () => {
    process.env.PEXELS_API_KEY = 'test-key';
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({
        videos: [
          {
            id: 1,
            url: 'https://pexels.com/video/1',
            image: 'https://pexels.com/thumb/1.jpg',
            duration: 12,
            user: { id: 99, name: 'John Doe', url: 'https://pexels.com/@johndoe' },
            video_files: [
              { id: 10, quality: 'hd', file_type: 'video/mp4', width: 1280, height: 720, link: 'https://cdn.pexels.com/video1.mp4' },
              { id: 11, quality: 'sd', file_type: 'video/mp4', width: 640, height: 360, link: 'https://cdn.pexels.com/video1-sd.mp4' },
            ],
          },
        ],
        total_results: 1,
      }), { status: 200 }),
    );

    const result = await searchStockVideo('nature landscape');

    expect(result).toEqual({
      url: 'https://cdn.pexels.com/video1.mp4',
      thumbnailUrl: 'https://pexels.com/thumb/1.jpg',
      duration: 12,
      source: 'pexels',
      photographer: 'John Doe',
      photographerUrl: 'https://pexels.com/@johndoe',
      pexelsVideoId: 1,
      pexelsVideoUrl: 'https://pexels.com/video/1',
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('api.pexels.com/videos/search'),
      expect.objectContaining({
        headers: { Authorization: 'test-key' },
      }),
    );
  });

  it('returns null when no videos match', async () => {
    process.env.PEXELS_API_KEY = 'test-key';
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ videos: [], total_results: 0 }), { status: 200 }),
    );

    const result = await searchStockVideo('very obscure query');
    expect(result).toBeNull();
  });

  it('returns null on API error', async () => {
    process.env.PEXELS_API_KEY = 'test-key';
    fetchSpy.mockResolvedValueOnce(
      new Response('Rate limited', { status: 429 }),
    );

    const result = await searchStockVideo('test');
    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    process.env.PEXELS_API_KEY = 'test-key';
    fetchSpy.mockRejectedValueOnce(new Error('Network error'));

    const result = await searchStockVideo('test');
    expect(result).toBeNull();
  });
});

describe('downloadStockAsset', () => {
  it('downloads and returns a buffer', async () => {
    const testData = new Uint8Array([1, 2, 3, 4]);
    fetchSpy.mockResolvedValueOnce(
      new Response(testData, { status: 200 }),
    );

    const result = await downloadStockAsset('https://cdn.example.com/video.mp4');
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBe(4);
  });

  it('throws on download failure', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('Not Found', { status: 404 }),
    );

    await expect(downloadStockAsset('https://cdn.example.com/missing.mp4'))
      .rejects.toThrow('Failed to download stock asset: 404');
  });
});
