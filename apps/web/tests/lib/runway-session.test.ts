import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockExecFileAsync, mockWriteFile, mockReadFileSync } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
  mockWriteFile: vi.fn(),
  mockReadFileSync: vi.fn().mockReturnValue('/* mock livekit-client.umd.js */'),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('util')>();
  return {
    ...actual,
    promisify: () => mockExecFileAsync,
  };
});

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    default: { ...actual, writeFile: (...args: unknown[]) => mockWriteFile(...args) },
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
  };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    default: { ...actual, readFileSync: mockReadFileSync },
    readFileSync: mockReadFileSync,
  };
});

// Playwright mock — use factory functions to avoid hoisting issues
vi.mock('playwright', () => {
  const page = {
    setContent: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const browser = {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
    __page: page,
  };
  return {
    chromium: {
      launch: vi.fn().mockResolvedValue(browser),
      __browser: browser,
    },
  };
});

import { recordRunwaySession } from '@/lib/runway-session';
import { chromium } from 'playwright';

function getMockBrowser() {
  return (chromium as unknown as { __browser: { newPage: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; __page: { evaluate: ReturnType<typeof vi.fn>; setContent: ReturnType<typeof vi.fn> } } }).__browser;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReadFileSync.mockReturnValue('/* mock livekit-client.umd.js */');
  mockWriteFile.mockResolvedValue(undefined);

  // Default: ffprobe returns duration, ffmpeg returns WAV buffer
  mockExecFileAsync.mockImplementation((_cmd: string, args: string[]) => {
    if (args && args.includes('-show_entries')) {
      return Promise.resolve({ stdout: '60.0\n', stderr: '' });
    }
    return Promise.resolve({ stdout: Buffer.from('fake-wav-data'), stderr: '' });
  });
});

describe('recordRunwaySession', () => {
  it('launches browser, sets content, and starts capture', async () => {
    const browser = getMockBrowser();
    const page = browser.__page;
    const onProgress = vi.fn();

    page.evaluate
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        recordingDone: true,
        error: null,
        videoBase64: Buffer.from('fake-video').toString('base64'),
      });

    const result = await recordRunwaySession({
      credentials: {
        url: 'wss://demo.livekit.cloud',
        token: 'lk-token',
        roomName: 'room-1',
      },
      audioFilePath: '/tmp/speaker.mp3',
      outputVideoPath: '/tmp/output.webm',
      onProgress,
    });

    expect(result.videoPath).toBe('/tmp/output.webm');
    expect(result.durationSeconds).toBe(60.0);
    expect(result.width).toBe(1088);
    expect(result.height).toBe(704);

    expect(onProgress).toHaveBeenCalledWith(10);
    expect(onProgress).toHaveBeenCalledWith(20);

    expect(mockWriteFile).toHaveBeenCalledWith(
      '/tmp/output.webm',
      expect.any(Buffer),
    );
  });

  it('throws on capture error from page', async () => {
    const page = getMockBrowser().__page;

    page.evaluate
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        recordingDone: false,
        error: 'LiveKit connection failed',
        videoBase64: null,
      });

    await expect(recordRunwaySession({
      credentials: { url: 'wss://demo.livekit.cloud', token: 'lk-token', roomName: 'room-1' },
      audioFilePath: '/tmp/speaker.mp3',
      outputVideoPath: '/tmp/output.webm',
    })).rejects.toThrow('Runway capture error: LiveKit connection failed');
  });

  it('closes browser in finally block even on error', async () => {
    const browser = getMockBrowser();
    browser.__page.evaluate.mockRejectedValueOnce(new Error('page crashed'));

    await expect(recordRunwaySession({
      credentials: { url: 'wss://demo.livekit.cloud', token: 'lk-token', roomName: 'room-1' },
      audioFilePath: '/tmp/speaker.mp3',
      outputVideoPath: '/tmp/output.webm',
    })).rejects.toThrow();

    expect(browser.close).toHaveBeenCalled();
  });
});
