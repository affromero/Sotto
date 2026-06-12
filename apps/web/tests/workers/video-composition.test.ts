import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockPrisma,
  mockUploadFile,
  mockAddJob,
} = vi.hoisted(() => {
  // Set REMOTION_URL inside vi.hoisted so it runs before static imports
  process.env.REMOTION_URL = 'http://remotion:3100';
  return {
  mockPrisma: {
    episode: { findUnique: vi.fn(), update: vi.fn() },
    videoGeneration: { update: vi.fn() },
    segment: { findMany: vi.fn() },
    segmentVisual: { findMany: vi.fn() },
    avatarOverlay: { findMany: vi.fn().mockResolvedValue([]) },
    segmentTransition: { findMany: vi.fn().mockResolvedValue([]) },
  },
  mockUploadFile: vi.fn().mockResolvedValue('https://cdn.example.com/video.mp4'),
  mockAddJob: vi.fn(),
  };
});

vi.mock('@/lib/prisma', () => ({ prismaUnfiltered: mockPrisma }));
vi.mock('@/lib/r2', () => ({
  uploadFile: (...args: unknown[]) => mockUploadFile(...args),
}));
vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: { SEND_NOTIFICATION: 'send_notification' },
  notificationQueue: { name: 'notifications' },
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { processVideoComposition } from '@/workers/video-composition.worker';

const mockFetch = vi.fn();

function makeJob(data: Record<string, unknown>) {
  return { data, updateProgress: vi.fn() } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('video-composition worker', () => {
  const baseData = { episodeId: 'pod-1', videoGenerationId: 'vg-1' };

  const episode = {
    id: 'pod-1',
    audioUrl: 'https://cdn.example.com/audio.mp3',
    duration: 300,
    title: 'Test Episode',
    userId: 'user-1',
  };

  const segments = [
    { id: 'seg-1', order: 0, speaker: 'Host', text: 'Hello', startTime: 0, duration: 5 },
    { id: 'seg-2', order: 1, speaker: 'Expert', text: 'Data shows...', startTime: 5, duration: 8 },
  ];

  const segmentVisuals = [
    { segmentId: 'seg-1', visualType: 'AI_ILLUSTRATION', prompt: 'editorial', metadata: null, assetUrl: 'https://cdn.example.com/vis.png', assetType: 'image/png', subOrder: 0, startOffset: 0, subDuration: 5 },
    { segmentId: 'seg-2', visualType: 'TEXT_CARD', prompt: null, metadata: { headline: 'Stats' }, assetUrl: null, assetType: null, subOrder: 0, startOffset: 0, subDuration: 8 },
  ];

  it('skips if episode was deleted', async () => {
    mockPrisma.episode.findUnique.mockResolvedValue(null);

    await processVideoComposition(makeJob(baseData));

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it('throws if episode has no audio URL', async () => {
    mockPrisma.episode.findUnique.mockResolvedValue({ ...episode, audioUrl: null });

    await expect(processVideoComposition(makeJob(baseData))).rejects.toThrow('No audio URL available');
  });

  it('renders video end-to-end and uploads to R2', async () => {
    mockPrisma.episode.findUnique.mockResolvedValue(episode);
    mockPrisma.segment.findMany.mockResolvedValue(segments);
    mockPrisma.segmentVisual.findMany.mockResolvedValue(segmentVisuals);

    mockFetch
      // Render request
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jobId: 'render-1' }),
      })
      // Status poll — done
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'done', progress: 1 }),
      })
      // Output download
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
      });

    // Run the worker — advance timers so the polling setTimeout resolves
    const promise = processVideoComposition(makeJob(baseData));
    await vi.advanceTimersByTimeAsync(10000);
    await promise;

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/render'),
      expect.objectContaining({ method: 'POST' }),
    );

    expect(mockUploadFile).toHaveBeenCalledWith(
      'episodes/pod-1/video.mp4',
      expect.any(Buffer),
      'video/mp4',
    );

    expect(mockPrisma.videoGeneration.update).toHaveBeenCalledWith({
      where: { id: 'vg-1' },
      data: expect.objectContaining({ status: 'READY', videoUrl: expect.any(String) }),
    });

    expect(mockPrisma.episode.update).toHaveBeenCalledWith({
      where: { id: 'pod-1' },
      data: { videoUrl: expect.any(String) },
    });

    expect(mockAddJob).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'notifications' }),
      'send_notification',
      expect.objectContaining({ userId: 'user-1', type: 'VIDEO_READY' }),
    );
  });

  it('throws on Remotion render failure', async () => {
    mockPrisma.episode.findUnique.mockResolvedValue(episode);
    mockPrisma.segment.findMany.mockResolvedValue(segments);
    mockPrisma.segmentVisual.findMany.mockResolvedValue(segmentVisuals);

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jobId: 'render-2' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'error', progress: 0.5, error: 'out of memory' }),
      });

    const promise = processVideoComposition(makeJob(baseData));
    // Attach rejection handler before advancing timers to avoid unhandled rejection
    const assertion = expect(promise).rejects.toThrow('out of memory');
    await vi.advanceTimersByTimeAsync(10000);
    await assertion;
  });

  it('includes segment timing in render payload', async () => {
    mockPrisma.episode.findUnique.mockResolvedValue(episode);
    mockPrisma.segment.findMany.mockResolvedValue(segments);
    mockPrisma.segmentVisual.findMany.mockResolvedValue(segmentVisuals);

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jobId: 'render-tts' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'done', progress: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(512)),
      });

    const promise = processVideoComposition(makeJob(baseData));
    await vi.advanceTimersByTimeAsync(10000);
    await promise;

    const renderCall = mockFetch.mock.calls[0];
    const body = JSON.parse(renderCall[1].body);
    expect(body.segments[0].startTime).toBe(0);
    expect(body.segments[0].duration).toBe(5);
    expect(body.segments[1].startTime).toBe(5);
    expect(body.segments[1].duration).toBe(8);
  });

  it('throws on 429 from Remotion sidecar', async () => {
    mockPrisma.episode.findUnique.mockResolvedValue(episode);
    mockPrisma.segment.findMany.mockResolvedValue(segments);
    mockPrisma.segmentVisual.findMany.mockResolvedValue(segmentVisuals);

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: () => Promise.resolve('busy'),
    });

    const promise = processVideoComposition(makeJob(baseData));
    const assertion = expect(promise).rejects.toThrow('busy');
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });
});
