import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockExecFileAsync, mockCopyFile, mockWriteFile } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
  mockCopyFile: vi.fn(),
  mockWriteFile: vi.fn(),
}));

vi.mock('util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('util')>();
  return {
    ...actual,
    default: { ...actual, promisify: () => mockExecFileAsync },
    promisify: () => mockExecFileAsync,
  };
});

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    default: {
      ...actual,
      writeFile: (...args: unknown[]) => mockWriteFile(...args),
      copyFile: (...args: unknown[]) => mockCopyFile(...args),
    },
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    copyFile: (...args: unknown[]) => mockCopyFile(...args),
  };
});

import {
  splitAudioIntoChunks,
  concatenateVideoChunks,
  RUNWAY_MAX_SESSION_SECONDS,
  RUNWAY_CHUNK_TARGET_SECONDS,
} from '@/lib/runway-chunker';

beforeEach(() => {
  vi.clearAllMocks();
  mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });
  mockCopyFile.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
});

describe('constants', () => {
  it('has correct session limits', () => {
    expect(RUNWAY_MAX_SESSION_SECONDS).toBe(300);
    expect(RUNWAY_CHUNK_TARGET_SECONDS).toBe(280);
  });
});

describe('splitAudioIntoChunks', () => {
  it('returns single chunk for short audio (no FFmpeg)', async () => {
    const chunks = await splitAudioIntoChunks({
      audioPath: '/tmp/audio.mp3',
      totalDuration: 120,
      tmpDir: '/tmp/work',
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({
      index: 0,
      inputPath: '/tmp/audio.mp3',
      outputPath: '/tmp/work/chunk-video-0.webm',
      startSeconds: 0,
      durationSeconds: 120,
    });
    expect(mockExecFileAsync).not.toHaveBeenCalled();
  });

  it('returns single chunk at exactly 280s boundary', async () => {
    const chunks = await splitAudioIntoChunks({
      audioPath: '/tmp/audio.mp3',
      totalDuration: 280,
      tmpDir: '/tmp/work',
    });

    expect(chunks).toHaveLength(1);
    expect(mockExecFileAsync).not.toHaveBeenCalled();
  });

  it('splits 500s audio into 2 chunks', async () => {
    const chunks = await splitAudioIntoChunks({
      audioPath: '/tmp/audio.mp3',
      totalDuration: 500,
      tmpDir: '/tmp/work',
    });

    expect(chunks).toHaveLength(2);
    expect(chunks[0].startSeconds).toBe(0);
    expect(chunks[0].durationSeconds).toBe(280);
    expect(chunks[1].startSeconds).toBe(280);
    expect(chunks[1].durationSeconds).toBe(220);
    expect(mockExecFileAsync).toHaveBeenCalledTimes(2);
  });

  it('splits 600s audio into 3 chunks', async () => {
    const chunks = await splitAudioIntoChunks({
      audioPath: '/tmp/audio.mp3',
      totalDuration: 600,
      tmpDir: '/tmp/work',
    });

    expect(chunks).toHaveLength(3);
    expect(chunks[0].durationSeconds).toBe(280);
    expect(chunks[1].durationSeconds).toBe(280);
    expect(chunks[2].durationSeconds).toBe(40);
  });

  it('generates correct FFmpeg args for each chunk', async () => {
    await splitAudioIntoChunks({
      audioPath: '/tmp/audio.mp3',
      totalDuration: 300,
      tmpDir: '/tmp/work',
    });

    // First chunk: -ss 0 -t 280
    const firstArgs = mockExecFileAsync.mock.calls[0][1] as string[];
    expect(firstArgs).toContain('-ss');
    expect(firstArgs).toContain('0');
    expect(firstArgs).toContain('-t');
    expect(firstArgs).toContain('280');

    // Second chunk: -ss 280 -t 20
    const secondArgs = mockExecFileAsync.mock.calls[1][1] as string[];
    expect(secondArgs).toContain('280');
    expect(secondArgs).toContain('20');
  });
});

describe('concatenateVideoChunks', () => {
  it('copies single chunk directly (no FFmpeg)', async () => {
    await concatenateVideoChunks({
      chunks: [{
        index: 0,
        inputPath: '/tmp/chunk-0.mp3',
        outputPath: '/tmp/chunk-video-0.webm',
        startSeconds: 0,
        durationSeconds: 120,
      }],
      outputPath: '/tmp/final.webm',
    });

    expect(mockCopyFile).toHaveBeenCalledWith('/tmp/chunk-video-0.webm', '/tmp/final.webm');
    expect(mockExecFileAsync).not.toHaveBeenCalled();
  });

  it('concatenates multiple chunks via FFmpeg', async () => {
    await concatenateVideoChunks({
      chunks: [
        { index: 0, inputPath: '/tmp/c0.mp3', outputPath: '/tmp/v0.webm', startSeconds: 0, durationSeconds: 280 },
        { index: 1, inputPath: '/tmp/c1.mp3', outputPath: '/tmp/v1.webm', startSeconds: 280, durationSeconds: 20 },
      ],
      outputPath: '/tmp/final.webm',
    });

    // Should write concat list file
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const listContent = mockWriteFile.mock.calls[0][1] as string;
    expect(listContent).toContain("file '/tmp/v0.webm'");
    expect(listContent).toContain("file '/tmp/v1.webm'");

    // Should call FFmpeg with concat demuxer
    expect(mockExecFileAsync).toHaveBeenCalledTimes(1);
    const ffmpegArgs = mockExecFileAsync.mock.calls[0][1] as string[];
    expect(ffmpegArgs).toContain('-f');
    expect(ffmpegArgs).toContain('concat');
    expect(ffmpegArgs).toContain('-c');
    expect(ffmpegArgs).toContain('copy');
  });
});
