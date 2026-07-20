import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  episodeUpdate: vi.fn(),
  segmentFindMany: vi.fn(),
  segmentUpsert: vi.fn(),
  segmentUpdate: vi.fn(),
  segmentDeleteMany: vi.fn(),
  addJob: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    episode: { update: (...args: unknown[]) => mocks.episodeUpdate(...args) },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        segment: {
          findMany: (...args: unknown[]) => mocks.segmentFindMany(...args),
          upsert: (...args: unknown[]) => mocks.segmentUpsert(...args),
          update: (...args: unknown[]) => mocks.segmentUpdate(...args),
          deleteMany: (...args: unknown[]) => mocks.segmentDeleteMany(...args),
        },
      }),
  },
}));

vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mocks.addJob(...args),
  JobType: { GENERATE_AUDIO: 'generate_audio' },
  audioGenerationQueue: { name: 'audio-generation' },
}));

import { createSegmentsAndQueueAudio, restartExistingSegmentAudio } from '@/lib/segment-creator';

describe('createSegmentsAndQueueAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.episodeUpdate.mockResolvedValue({});
    mocks.segmentFindMany.mockResolvedValue([]);
    mocks.segmentUpsert
      .mockResolvedValueOnce({
        id: 'segment-1',
        order: 0,
        version: 1,
        audioUrl: null,
        speaker: 'HOST',
        text: 'First turn',
      })
      .mockResolvedValueOnce({
        id: 'segment-2',
        order: 1,
        version: 1,
        audioUrl: null,
        speaker: 'EXPERT',
        text: 'Second turn',
      });
    mocks.segmentDeleteMany.mockResolvedValue({ count: 0 });
    mocks.addJob.mockResolvedValue({ id: 'job' });
  });

  it('uses a new generation attempt in every audio payload and job identity', async () => {
    await createSegmentsAndQueueAudio('episode-1', [
      { speaker: 'HOST', text: 'First turn' },
      { speaker: 'EXPERT', text: 'Second turn' },
    ]);

    const generationKey = mocks.episodeUpdate.mock.calls[0][0].data.audioGenerationKey as string;
    expect(generationKey).toMatch(/^[a-f0-9-]{36}$/);
    expect(mocks.addJob).toHaveBeenCalledTimes(2);
    for (const call of mocks.addJob.mock.calls) {
      expect(call[2].audioGenerationKey).toBe(generationKey);
      expect(call[3].jobId).toContain(generationKey);
    }
  });

  it('invalidates and requeues every segment in a replacement audio attempt', async () => {
    mocks.segmentFindMany.mockResolvedValue([{ id: 'segment-1' }, { id: 'segment-2' }]);
    mocks.segmentUpdate
      .mockResolvedValueOnce({
        id: 'segment-1',
        version: 2,
        speaker: 'HOST',
        text: 'First turn',
      })
      .mockResolvedValueOnce({
        id: 'segment-2',
        version: 4,
        speaker: 'EXPERT',
        text: 'Second turn',
      });

    const count = await restartExistingSegmentAudio('episode-1', 'replacement-attempt');

    expect(count).toBe(2);
    expect(mocks.segmentUpdate).toHaveBeenCalledTimes(2);
    for (const call of mocks.segmentUpdate.mock.calls) {
      expect(call[0].data).toEqual({
        version: { increment: 1 },
        audioUrl: null,
        duration: null,
        startTime: null,
        wordTimings: expect.anything(),
      });
    }
    expect(mocks.addJob).toHaveBeenCalledTimes(2);
    expect(mocks.addJob.mock.calls.map((call) => call[2].segmentVersion)).toEqual([2, 4]);
    expect(mocks.addJob.mock.calls.map((call) => call[2].audioGenerationKey)).toEqual([
      'replacement-attempt',
      'replacement-attempt',
    ]);
  });
});
