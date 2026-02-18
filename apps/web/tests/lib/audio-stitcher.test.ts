import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ExecFileException } from 'child_process';

// Mock modules before imports
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock child_process
const mockExecFile = vi.fn();
vi.mock('child_process', () => ({
  execFile: mockExecFile,
}));

// Mock util.promisify to return our mock
vi.mock('util', () => ({
  promisify: vi.fn((fn) => {
    if (fn === mockExecFile) {
      return vi.fn(async (...args: unknown[]) => {
        return mockExecFile(...args);
      });
    }
    return fn;
  }),
}));

// Mock fs/promises
const mockWriteFile = vi.fn();
const mockUnlink = vi.fn();
vi.mock('fs/promises', () => ({
  writeFile: mockWriteFile,
  unlink: mockUnlink,
}));

import { stitchWithEffects, stitchSegments, getAudioDuration } from '@/lib/audio-stitcher';

describe('audio-stitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('stitchSegments', () => {
    it('stitches multiple segments successfully', async () => {
      const segmentPaths = ['/tmp/seg1.mp3', '/tmp/seg2.mp3', '/tmp/seg3.mp3'];
      const outputPath = '/tmp/output.mp3';

      mockWriteFile.mockResolvedValue(undefined);
      mockUnlink.mockResolvedValue(undefined);

      await expect(stitchSegments(segmentPaths, outputPath)).resolves.not.toThrow();
    });

    it('cleans up concat file after stitching', async () => {
      const segmentPaths = ['/tmp/seg1.mp3'];
      const outputPath = '/tmp/output.mp3';

      mockWriteFile.mockResolvedValue(undefined);
      mockUnlink.mockResolvedValue(undefined);

      await expect(stitchSegments(segmentPaths, outputPath)).resolves.not.toThrow();
    });

    it('cleans up concat file even if FFmpeg fails', async () => {
      const segmentPaths = ['/tmp/seg1.mp3'];
      const outputPath = '/tmp/output.mp3';

      mockWriteFile.mockResolvedValue(undefined);
      mockUnlink.mockResolvedValue(undefined);
      mockExecFile.mockRejectedValue(new Error('FFmpeg failed'));

      await expect(stitchSegments(segmentPaths, outputPath)).rejects.toThrow('FFmpeg failed');
      expect(mockUnlink).toHaveBeenCalledWith(`${outputPath}.concat.txt`);
    });

    it('handles unlink errors silently', async () => {
      const segmentPaths = ['/tmp/seg1.mp3'];
      const outputPath = '/tmp/output.mp3';

      mockWriteFile.mockResolvedValue(undefined);
      mockUnlink.mockRejectedValue(new Error('File not found'));

      await stitchSegments(segmentPaths, outputPath);

      expect(mockUnlink).toHaveBeenCalled();
    });

    it('handles single segment', async () => {
      const segmentPaths = ['/tmp/seg1.mp3'];
      const outputPath = '/tmp/output.mp3';

      mockWriteFile.mockResolvedValue(undefined);
      mockUnlink.mockResolvedValue(undefined);

      await expect(stitchSegments(segmentPaths, outputPath)).resolves.not.toThrow();
    });

    it('handles multiple segments', async () => {
      const segmentPaths = ['/tmp/seg1.mp3', '/tmp/seg2.mp3', '/tmp/seg3.mp3', '/tmp/seg4.mp3'];
      const outputPath = '/tmp/output.mp3';

      mockWriteFile.mockResolvedValue(undefined);
      mockUnlink.mockResolvedValue(undefined);

      await expect(stitchSegments(segmentPaths, outputPath)).resolves.not.toThrow();
    });

    it('throws error when FFmpeg is not found', async () => {
      const segmentPaths = ['/tmp/seg1.mp3'];
      const outputPath = '/tmp/output.mp3';

      mockWriteFile.mockResolvedValue(undefined);
      mockUnlink.mockResolvedValue(undefined);
      const error = new Error('Command not found') as ExecFileException;
      error.code = 'ENOENT';
      mockExecFile.mockRejectedValue(error);

      await expect(stitchSegments(segmentPaths, outputPath)).rejects.toThrow('Command not found');
    });

    it('throws error when FFmpeg fails with exit code', async () => {
      const segmentPaths = ['/tmp/seg1.mp3'];
      const outputPath = '/tmp/output.mp3';

      mockWriteFile.mockResolvedValue(undefined);
      mockUnlink.mockResolvedValue(undefined);
      const error = new Error('FFmpeg error') as ExecFileException;
      error.code = '1';
      mockExecFile.mockRejectedValue(error);

      await expect(stitchSegments(segmentPaths, outputPath)).rejects.toThrow('FFmpeg error');
    });

  });

  describe('stitchWithEffects', () => {
    it('throws error when no segments provided', async () => {
      await expect(
        stitchWithEffects({
          segmentPaths: [],
          sfxInserts: [],
          outputPath: '/tmp/output.mp3',
        })
      ).rejects.toThrow('No segments to stitch');
    });

    it('returns duration for single segment with no SFX', async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '123.456', stderr: '' });

      const result = await stitchWithEffects({
        segmentPaths: ['/tmp/seg1.mp3'],
        sfxInserts: [],
        outputPath: '/tmp/output.mp3',
      });

      expect(result.duration).toBe(123.456);
    });

    it('returns duration for multiple segments without SFX', async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '200.5', stderr: '' });

      const result = await stitchWithEffects({
        segmentPaths: ['/tmp/seg1.mp3', '/tmp/seg2.mp3', '/tmp/seg3.mp3'],
        sfxInserts: [],
        outputPath: '/tmp/output.mp3',
      });

      expect(result.duration).toBe(200.5);
    });
  });

  describe('getAudioDuration', () => {
    it('parses duration from stdout', async () => {
      mockExecFile.mockResolvedValue({ stdout: '456.789', stderr: '' });

      const duration = await getAudioDuration('/tmp/audio.mp3');

      expect(duration).toBe(456.789);
    });

    it('handles duration with trailing whitespace', async () => {
      mockExecFile.mockResolvedValue({ stdout: '  123.45  \n', stderr: '' });

      const duration = await getAudioDuration('/tmp/audio.mp3');

      expect(duration).toBe(123.45);
    });

    it('throws error when FFprobe fails', async () => {
      mockExecFile.mockRejectedValue(new Error('FFprobe error'));

      await expect(getAudioDuration('/tmp/audio.mp3')).rejects.toThrow('FFprobe error');
    });

    it('returns NaN for invalid duration output', async () => {
      mockExecFile.mockResolvedValue({ stdout: 'invalid', stderr: '' });

      const duration = await getAudioDuration('/tmp/audio.mp3');

      expect(duration).toBe(NaN);
    });
  });
});
