import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Hoisted mocks ---

const {
  mockExecFileAsync,
  mockReadFile,
  mockWriteFile,
  mockLaunch,
  mockNewContext,
  mockNewPage,
  mockPageExposeFunction,
  mockPageOn,
  mockPageGoto,
  mockPageAddScriptTag,
  mockPageWaitForFunction,
  mockPageEvaluate,
  mockBrowserClose,
} = vi.hoisted(() => {
  const mockPageExposeFunction = vi.fn();
  const mockPageOn = vi.fn();
  const mockPageGoto = vi.fn();
  const mockPageAddScriptTag = vi.fn();
  const mockPageWaitForFunction = vi.fn();
  const mockPageEvaluate = vi.fn();
  const mockBrowserClose = vi.fn();
  const mockNewPage = vi.fn();
  const mockNewContext = vi.fn();
  const mockLaunch = vi.fn();

  return {
    mockExecFileAsync: vi.fn(),
    mockReadFile: vi.fn(),
    mockWriteFile: vi.fn(),
    mockLaunch,
    mockNewContext,
    mockNewPage,
    mockPageExposeFunction,
    mockPageOn,
    mockPageGoto,
    mockPageAddScriptTag,
    mockPageWaitForFunction,
    mockPageEvaluate,
    mockBrowserClose,
  };
});

// --- Module mocks ---

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('util', () => ({
  default: { promisify: () => mockExecFileAsync },
  promisify: () => mockExecFileAsync,
}));

vi.mock('child_process', () => ({
  default: { execFile: vi.fn() },
  execFile: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  default: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
  },
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

vi.mock('playwright', () => ({
  chromium: {
    launch: (...args: unknown[]) => mockLaunch(...args),
  },
}));

import { recordRunwaySession } from '@/lib/runway-session';

const baseCredentials = { url: 'wss://demo.livekit.cloud', token: 'lk-token', roomName: 'room-1' };
const fakeAudioBuffer = Buffer.from('fake-audio-data');
const fakeChunkBase64 = Buffer.from('fake-video-chunk').toString('base64');

beforeEach(() => {
  vi.resetAllMocks();

  // ffprobe: 10s duration
  mockExecFileAsync.mockResolvedValue({ stdout: '10.0\n', stderr: '' });

  // fs/promises
  mockReadFile.mockResolvedValue(fakeAudioBuffer);
  mockWriteFile.mockResolvedValue(undefined);

  // Build mock page
  mockPageOn.mockReturnValue(undefined);
  mockPageExposeFunction.mockImplementation(async (name: string, fn: (arg: string) => void) => {
    if (name === 'onVideoChunk') {
      // Deliver one fake video chunk immediately so chunkBuffers is non-empty
      fn(fakeChunkBase64);
    }
  });
  mockPageGoto.mockResolvedValue(undefined);
  mockPageAddScriptTag.mockResolvedValue(undefined);
  mockPageWaitForFunction.mockResolvedValue(undefined);
  mockPageEvaluate.mockResolvedValue({ width: 1088, height: 704, error: null });

  // Wire up browser chain: launch → context → page
  const fakePage = {
    on: (...args: unknown[]) => mockPageOn(...args),
    exposeFunction: (...args: unknown[]) => mockPageExposeFunction(...args),
    goto: (...args: unknown[]) => mockPageGoto(...args),
    addScriptTag: (...args: unknown[]) => mockPageAddScriptTag(...args),
    waitForFunction: (...args: unknown[]) => mockPageWaitForFunction(...args),
    evaluate: (...args: unknown[]) => mockPageEvaluate(...args),
  };
  mockNewPage.mockResolvedValue(fakePage);
  mockNewContext.mockResolvedValue({ newPage: mockNewPage });
  mockBrowserClose.mockResolvedValue(undefined);
  mockLaunch.mockResolvedValue({ newContext: mockNewContext, close: mockBrowserClose });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('recordRunwaySession', () => {
  it('launches headless Chrome, runs browser session, and writes output', async () => {
    const onProgress = vi.fn();
    const result = await recordRunwaySession({
      credentials: baseCredentials,
      audioFilePath: '/tmp/speaker.mp3',
      outputVideoPath: '/tmp/output.webm',
      onProgress,
      _delayMs: { trailing: 0 },
    });

    expect(result.videoPath).toBe('/tmp/output.webm');
    expect(result.durationSeconds).toBe(10.0);
    expect(result.width).toBe(1088);
    expect(result.height).toBe(704);

    expect(mockLaunch).toHaveBeenCalledWith(
      expect.objectContaining({ headless: true }),
    );
    expect(mockPageEvaluate).toHaveBeenCalledTimes(1);
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/tmp/output.webm',
      expect.any(Buffer),
    );
    expect(mockBrowserClose).toHaveBeenCalled();
    expect(onProgress).toHaveBeenCalledWith(5);
    expect(onProgress).toHaveBeenCalledWith(10);
    expect(onProgress).toHaveBeenCalledWith(95);
  });

  it('throws when browser session returns no video chunks', async () => {
    // exposeFunction for onVideoChunk does NOT call callback → chunkBuffers stays empty
    mockPageExposeFunction.mockResolvedValue(undefined);

    await expect(
      recordRunwaySession({
        credentials: baseCredentials,
        audioFilePath: '/tmp/speaker.mp3',
        outputVideoPath: '/tmp/output.webm',
        _delayMs: { trailing: 0 },
      }),
    ).rejects.toThrow('No video chunks received from Runway browser session');
  });

  it('throws when browser session returns an error', async () => {
    mockPageEvaluate.mockResolvedValue({
      width: 0,
      height: 0,
      error: 'Video track not subscribed within 15s',
    });

    await expect(
      recordRunwaySession({
        credentials: baseCredentials,
        audioFilePath: '/tmp/speaker.mp3',
        outputVideoPath: '/tmp/output.webm',
        _delayMs: { trailing: 0 },
      }),
    ).rejects.toThrow('Video track not subscribed within 15s');
  });

  it('reads audio file and passes it as base64 data URL to browser', async () => {
    await recordRunwaySession({
      credentials: baseCredentials,
      audioFilePath: '/tmp/speaker.mp3',
      outputVideoPath: '/tmp/output.webm',
      _delayMs: { trailing: 0 },
    });

    expect(mockReadFile).toHaveBeenCalledWith('/tmp/speaker.mp3');

    const params = mockPageEvaluate.mock.calls[0][1] as Record<string, unknown>;
    const expectedDataUrl = `data:audio/mpeg;base64,${fakeAudioBuffer.toString('base64')}`;
    expect(params.audioDataUrl).toBe(expectedDataUrl);
    expect(params.credentials).toEqual(baseCredentials);
  });
});
