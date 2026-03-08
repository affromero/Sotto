import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockExecFile = vi.fn((_cmd: string, _args: string[], cb: (err: null, result: { stdout: string }) => void) => {
  cb(null, { stdout: '65.3\n' });
});

vi.doMock('child_process', () => ({
  execFile: mockExecFile,
}));

vi.doMock('util', () => ({
  promisify: (fn: typeof mockExecFile) => (...args: unknown[]) => {
    return new Promise((resolve, reject) => {
      const filteredArgs = args.filter(a => typeof a !== 'function');
      fn(...filteredArgs as [string, string[]], (err: null, result: { stdout: string }) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  },
}));

vi.doMock('fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.doMock('path', () => ({
  join: (...args: string[]) => args.join('/'),
  dirname: (p: string) => p.split('/').slice(0, -1).join('/'),
}));

// Mock fetch for downloading segment audio
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
}));

import { concatenateSpeakerAudio } from '@/lib/avatar-audio-concat';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('concatenateSpeakerAudio', () => {
  it('throws when given no segments', async () => {
    await expect(concatenateSpeakerAudio({
      segments: [],
      outputPath: '/tmp/out.mp3',
    })).rejects.toThrow('No segments to concatenate');
  });

  it('sorts segments by order before concatenating', async () => {
    const result = await concatenateSpeakerAudio({
      segments: [
        { audioUrl: 'https://r2/seg3.mp3', order: 3 },
        { audioUrl: 'https://r2/seg1.mp3', order: 1 },
        { audioUrl: 'https://r2/seg2.mp3', order: 2 },
      ],
      outputPath: '/tmp/test/out.mp3',
    });

    expect(result.durationSeconds).toBeCloseTo(65.3, 1);
    // Fetch called 6 times: 3 HEAD (pre-validation) + 3 GET (download)
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it('returns duration from ffprobe output', async () => {
    const result = await concatenateSpeakerAudio({
      segments: [{ audioUrl: 'https://r2/seg1.mp3', order: 1 }],
      outputPath: '/tmp/test/single.mp3',
    });

    expect(result.durationSeconds).toBeCloseTo(65.3, 1);
  });

  it('throws when segment audio is missing from storage (HEAD check)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }));

    await expect(concatenateSpeakerAudio({
      segments: [{ audioUrl: 'https://r2/missing.mp3', order: 1 }],
      outputPath: '/tmp/test/out.mp3',
    })).rejects.toThrow('1 segment audio file(s) missing from storage');
  });

  it('reports all missing segments in pre-validation error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }));

    await expect(concatenateSpeakerAudio({
      segments: [
        { audioUrl: 'https://r2/seg1.mp3', order: 1 },
        { audioUrl: 'https://r2/seg2.mp3', order: 2 },
      ],
      outputPath: '/tmp/test/out.mp3',
    })).rejects.toThrow('2 segment audio file(s) missing from storage');
  });
});
