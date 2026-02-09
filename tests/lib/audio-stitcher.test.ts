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
import type { SfxInsert } from '@/lib/audio-stitcher';

describe('audio-stitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('stitchSegments', () => {
    it('creates concat file with all segment paths', async () => {
      const segmentPaths = ['/tmp/seg1.mp3', '/tmp/seg2.mp3', '/tmp/seg3.mp3'];
      const outputPath = '/tmp/output.mp3';

      mockWriteFile.mockResolvedValue(undefined);
      mockUnlink.mockResolvedValue(undefined);

      await stitchSegments(segmentPaths, outputPath);

      expect(mockWriteFile).toHaveBeenCalledWith(
        `${outputPath}.concat.txt`,
        "file '/tmp/seg1.mp3'\nfile '/tmp/seg2.mp3'\nfile '/tmp/seg3.mp3'"
      );
    });

    it('calls FFmpeg with concat demuxer and normalization', async () => {
      const segmentPaths = ['/tmp/seg1.mp3', '/tmp/seg2.mp3'];
      const outputPath = '/tmp/output.mp3';

      mockWriteFile.mockResolvedValue(undefined);
      mockUnlink.mockResolvedValue(undefined);

      await stitchSegments(segmentPaths, outputPath);

      expect(mockExecFile).toHaveBeenCalledWith(
        'ffmpeg',
        expect.arrayContaining([
          '-y',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          `${outputPath}.concat.txt`,
          '-c:a',
          'libmp3lame',
          '-b:a',
          '192k',
          '-ar',
          '44100',
          '-ac',
          '2',
          '-filter:a',
          'loudnorm=I=-16:TP=-1.5:LRA=11',
          outputPath,
        ])
      );
    });

    it('cleans up concat file after stitching', async () => {
      const segmentPaths = ['/tmp/seg1.mp3'];
      const outputPath = '/tmp/output.mp3';

      mockWriteFile.mockResolvedValue(undefined);
      mockUnlink.mockResolvedValue(undefined);

      await stitchSegments(segmentPaths, outputPath);

      expect(mockUnlink).toHaveBeenCalledWith(`${outputPath}.concat.txt`);
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

      await stitchSegments(segmentPaths, outputPath);

      expect(mockWriteFile).toHaveBeenCalledWith(
        `${outputPath}.concat.txt`,
        "file '/tmp/seg1.mp3'"
      );
    });

    it('handles multiple segments', async () => {
      const segmentPaths = ['/tmp/seg1.mp3', '/tmp/seg2.mp3', '/tmp/seg3.mp3', '/tmp/seg4.mp3'];
      const outputPath = '/tmp/output.mp3';

      mockWriteFile.mockResolvedValue(undefined);
      mockUnlink.mockResolvedValue(undefined);

      await stitchSegments(segmentPaths, outputPath);

      expect(mockWriteFile).toHaveBeenCalledWith(
        `${outputPath}.concat.txt`,
        expect.stringContaining('/tmp/seg4.mp3')
      );
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

    it('applies loudness normalization with correct parameters', async () => {
      const segmentPaths = ['/tmp/seg1.mp3'];
      const outputPath = '/tmp/output.mp3';

      mockWriteFile.mockResolvedValue(undefined);
      mockUnlink.mockResolvedValue(undefined);

      await stitchSegments(segmentPaths, outputPath);

      const callArgs = mockExecFile.mock.calls[0][1];
      const filterIndex = callArgs.indexOf('-filter:a');
      expect(callArgs[filterIndex + 1]).toBe('loudnorm=I=-16:TP=-1.5:LRA=11');
    });

    it('outputs MP3 with 192k bitrate', async () => {
      const segmentPaths = ['/tmp/seg1.mp3'];
      const outputPath = '/tmp/output.mp3';

      mockWriteFile.mockResolvedValue(undefined);
      mockUnlink.mockResolvedValue(undefined);

      await stitchSegments(segmentPaths, outputPath);

      const callArgs = mockExecFile.mock.calls[0][1];
      expect(callArgs).toContain('-c:a');
      expect(callArgs).toContain('libmp3lame');
      expect(callArgs).toContain('-b:a');
      expect(callArgs).toContain('192k');
    });

    it('sets audio to 44100Hz stereo', async () => {
      const segmentPaths = ['/tmp/seg1.mp3'];
      const outputPath = '/tmp/output.mp3';

      mockWriteFile.mockResolvedValue(undefined);
      mockUnlink.mockResolvedValue(undefined);

      await stitchSegments(segmentPaths, outputPath);

      const callArgs = mockExecFile.mock.calls[0][1];
      expect(callArgs).toContain('-ar');
      expect(callArgs).toContain('44100');
      expect(callArgs).toContain('-ac');
      expect(callArgs).toContain('2');
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

    it('uses simple conversion for single segment with no SFX', async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '123.456', stderr: '' });

      const result = await stitchWithEffects({
        segmentPaths: ['/tmp/seg1.mp3'],
        sfxInserts: [],
        outputPath: '/tmp/output.mp3',
      });

      expect(mockExecFile).toHaveBeenCalledWith(
        'ffmpeg',
        expect.arrayContaining([
          '-y',
          '-i',
          '/tmp/seg1.mp3',
          '-c:a',
          'libmp3lame',
          '-b:a',
          '192k',
          '-ar',
          '44100',
          '-ac',
          '2',
          '-filter:a',
          'loudnorm=I=-16:TP=-1.5:LRA=11',
          '/tmp/output.mp3',
        ])
      );
      expect(result.duration).toBe(123.456);
    });

    it('builds filter graph for multiple segments without SFX', async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '200.5', stderr: '' });

      const result = await stitchWithEffects({
        segmentPaths: ['/tmp/seg1.mp3', '/tmp/seg2.mp3', '/tmp/seg3.mp3'],
        sfxInserts: [],
        outputPath: '/tmp/output.mp3',
      });

      const filterComplexArg = mockExecFile.mock.calls[0][1];
      const filterGraphIndex = filterComplexArg.indexOf('-filter_complex') + 1;
      const filterGraph = filterComplexArg[filterGraphIndex];

      expect(filterGraph).toContain('aformat=sample_fmts=fltp:sample_rates=44100');
      expect(filterGraph).toContain('acrossfade');
      expect(filterGraph).toContain('loudnorm=I=-16:TP=-1.5:LRA=11');
      expect(result.duration).toBe(200.5);
    });

    it('uses default crossfade duration of 300ms', async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '100', stderr: '' });

      await stitchWithEffects({
        segmentPaths: ['/tmp/seg1.mp3', '/tmp/seg2.mp3'],
        sfxInserts: [],
        outputPath: '/tmp/output.mp3',
      });

      const filterComplexArg = mockExecFile.mock.calls[0][1];
      const filterGraphIndex = filterComplexArg.indexOf('-filter_complex') + 1;
      const filterGraph = filterComplexArg[filterGraphIndex];

      expect(filterGraph).toContain('acrossfade=d=0.3');
    });

    it('uses custom crossfade duration when provided', async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '100', stderr: '' });

      await stitchWithEffects({
        segmentPaths: ['/tmp/seg1.mp3', '/tmp/seg2.mp3'],
        sfxInserts: [],
        outputPath: '/tmp/output.mp3',
        crossfadeMs: 500,
      });

      const filterComplexArg = mockExecFile.mock.calls[0][1];
      const filterGraphIndex = filterComplexArg.indexOf('-filter_complex') + 1;
      const filterGraph = filterComplexArg[filterGraphIndex];

      expect(filterGraph).toContain('acrossfade=d=0.5');
    });

    it('includes SFX inputs when SFX are provided', async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '150', stderr: '' });

      const sfxInserts: SfxInsert[] = [
        {
          path: '/tmp/sfx1.mp3',
          insertAfterSegment: 0,
          durationMs: 1000,
          type: 'intro',
        },
      ];

      await stitchWithEffects({
        segmentPaths: ['/tmp/seg1.mp3', '/tmp/seg2.mp3'],
        sfxInserts,
        outputPath: '/tmp/output.mp3',
      });

      const ffmpegArgs = mockExecFile.mock.calls[0][1];
      expect(ffmpegArgs).toContain('-i');
      expect(ffmpegArgs).toContain('/tmp/sfx1.mp3');
    });

    it('applies correct volume for ambient SFX', async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '150', stderr: '' });

      const sfxInserts: SfxInsert[] = [
        {
          path: '/tmp/ambient.mp3',
          insertAfterSegment: 0,
          durationMs: 5000,
          type: 'ambient',
        },
      ];

      await stitchWithEffects({
        segmentPaths: ['/tmp/seg1.mp3'],
        sfxInserts,
        outputPath: '/tmp/output.mp3',
      });

      const filterComplexArg = mockExecFile.mock.calls[0][1];
      const filterGraphIndex = filterComplexArg.indexOf('-filter_complex') + 1;
      const filterGraph = filterComplexArg[filterGraphIndex];

      expect(filterGraph).toContain('volume=0.15');
    });

    it('applies correct volume for transition SFX', async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '150', stderr: '' });

      const sfxInserts: SfxInsert[] = [
        {
          path: '/tmp/transition.mp3',
          insertAfterSegment: 0,
          durationMs: 500,
          type: 'transition',
        },
      ];

      await stitchWithEffects({
        segmentPaths: ['/tmp/seg1.mp3', '/tmp/seg2.mp3'],
        sfxInserts,
        outputPath: '/tmp/output.mp3',
      });

      const filterComplexArg = mockExecFile.mock.calls[0][1];
      const filterGraphIndex = filterComplexArg.indexOf('-filter_complex') + 1;
      const filterGraph = filterComplexArg[filterGraphIndex];

      expect(filterGraph).toContain('volume=0.3');
    });

    it('applies correct volume for intro SFX', async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '150', stderr: '' });

      const sfxInserts: SfxInsert[] = [
        {
          path: '/tmp/intro.mp3',
          insertAfterSegment: 0,
          durationMs: 2000,
          type: 'intro',
        },
      ];

      await stitchWithEffects({
        segmentPaths: ['/tmp/seg1.mp3'],
        sfxInserts,
        outputPath: '/tmp/output.mp3',
      });

      const filterComplexArg = mockExecFile.mock.calls[0][1];
      const filterGraphIndex = filterComplexArg.indexOf('-filter_complex') + 1;
      const filterGraph = filterComplexArg[filterGraphIndex];

      expect(filterGraph).toContain('volume=0.4');
    });

    it('applies correct volume for outro SFX', async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '150', stderr: '' });

      const sfxInserts: SfxInsert[] = [
        {
          path: '/tmp/outro.mp3',
          insertAfterSegment: 0,
          durationMs: 2000,
          type: 'outro',
        },
      ];

      await stitchWithEffects({
        segmentPaths: ['/tmp/seg1.mp3'],
        sfxInserts,
        outputPath: '/tmp/output.mp3',
      });

      const filterComplexArg = mockExecFile.mock.calls[0][1];
      const filterGraphIndex = filterComplexArg.indexOf('-filter_complex') + 1;
      const filterGraph = filterComplexArg[filterGraphIndex];

      expect(filterGraph).toContain('volume=0.4');
    });

    it('mixes multiple SFX into speech track', async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '180', stderr: '' });

      const sfxInserts: SfxInsert[] = [
        {
          path: '/tmp/sfx1.mp3',
          insertAfterSegment: 0,
          durationMs: 1000,
          type: 'intro',
        },
        {
          path: '/tmp/sfx2.mp3',
          insertAfterSegment: 1,
          durationMs: 500,
          type: 'transition',
        },
      ];

      await stitchWithEffects({
        segmentPaths: ['/tmp/seg1.mp3', '/tmp/seg2.mp3', '/tmp/seg3.mp3'],
        sfxInserts,
        outputPath: '/tmp/output.mp3',
      });

      const filterComplexArg = mockExecFile.mock.calls[0][1];
      const filterGraphIndex = filterComplexArg.indexOf('-filter_complex') + 1;
      const filterGraph = filterComplexArg[filterGraphIndex];

      expect(filterGraph).toContain('amix=inputs=2:duration=longest');
    });

    it('handles maxBuffer option for large files', async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '300', stderr: '' });

      await stitchWithEffects({
        segmentPaths: ['/tmp/seg1.mp3', '/tmp/seg2.mp3'],
        sfxInserts: [],
        outputPath: '/tmp/output.mp3',
      });

      expect(mockExecFile).toHaveBeenCalledWith('ffmpeg', expect.any(Array), {
        maxBuffer: 50 * 1024 * 1024,
      });
    });

    it('normalizes each speech segment to consistent format', async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '100', stderr: '' });

      await stitchWithEffects({
        segmentPaths: ['/tmp/seg1.mp3', '/tmp/seg2.mp3'],
        sfxInserts: [],
        outputPath: '/tmp/output.mp3',
      });

      const filterComplexArg = mockExecFile.mock.calls[0][1];
      const filterGraphIndex = filterComplexArg.indexOf('-filter_complex') + 1;
      const filterGraph = filterComplexArg[filterGraphIndex];

      expect(filterGraph).toContain(
        'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo'
      );
    });

    it('uses acopy for single segment without crossfade', async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '100', stderr: '' });

      await stitchWithEffects({
        segmentPaths: ['/tmp/seg1.mp3'],
        sfxInserts: [
          { path: '/tmp/sfx.mp3', insertAfterSegment: 0, durationMs: 1000, type: 'intro' },
        ],
        outputPath: '/tmp/output.mp3',
      });

      const filterComplexArg = mockExecFile.mock.calls[0][1];
      const filterGraphIndex = filterComplexArg.indexOf('-filter_complex') + 1;
      const filterGraph = filterComplexArg[filterGraphIndex];

      expect(filterGraph).toContain('acopy[speech]');
    });

    it('chains crossfades for more than 2 segments', async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '200', stderr: '' });

      await stitchWithEffects({
        segmentPaths: ['/tmp/seg1.mp3', '/tmp/seg2.mp3', '/tmp/seg3.mp3', '/tmp/seg4.mp3'],
        sfxInserts: [],
        outputPath: '/tmp/output.mp3',
      });

      const filterComplexArg = mockExecFile.mock.calls[0][1];
      const filterGraphIndex = filterComplexArg.indexOf('-filter_complex') + 1;
      const filterGraph = filterComplexArg[filterGraphIndex];

      expect(filterGraph).toContain('[seg0][seg1]acrossfade');
      expect(filterGraph).toContain('[xf0][seg2]acrossfade');
    });
  });

  describe('getAudioDuration', () => {
    it('calls FFprobe with correct arguments', async () => {
      mockExecFile.mockResolvedValue({ stdout: '123.456\n', stderr: '' });

      const duration = await getAudioDuration('/tmp/audio.mp3');

      expect(mockExecFile).toHaveBeenCalledWith('ffprobe', [
        '-v',
        'quiet',
        '-show_entries',
        'format=duration',
        '-of',
        'csv=p=0',
        '/tmp/audio.mp3',
      ]);
      expect(duration).toBe(123.456);
    });

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
