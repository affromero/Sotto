import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  episodeUpdate: vi.fn(),
  segmentFindMany: vi.fn(),
  segmentUpsert: vi.fn(),
  segmentUpdate: vi.fn(),
  segmentDeleteMany: vi.fn(),
  admittedChildren: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/sidedoor/jobs/core/durable-queue', () => ({
  admitDurableQueueBatch: async (options: {
    prepare: (database: unknown) => Promise<Array<Record<string, unknown>>>;
  }) => {
    mocks.admittedChildren = await options.prepare({
      episode: { update: (...args: unknown[]) => mocks.episodeUpdate(...args) },
      segment: {
        findMany: (...args: unknown[]) => mocks.segmentFindMany(...args),
        upsert: (...args: unknown[]) => mocks.segmentUpsert(...args),
        update: (...args: unknown[]) => mocks.segmentUpdate(...args),
        deleteMany: (...args: unknown[]) => mocks.segmentDeleteMany(...args),
      },
    });
  },
}));

vi.mock('@/lib/queue', () => ({
  JobType: { GENERATE_AUDIO: 'generate_audio' },
  audioGenerationQueue: { name: 'audio-generation' },
}));

import { createSegmentsAndQueueAudio, restartExistingSegmentAudio } from '@/lib/segment-creator';

describe('createSegmentsAndQueueAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.admittedChildren = [];
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
  });

  it('uses a new generation attempt in every audio payload and job identity', async () => {
    await createSegmentsAndQueueAudio(
      'episode-1',
      [
        { speaker: 'HOST', text: 'First turn' },
        { speaker: 'EXPERT', text: 'Second turn' },
      ],
      { authorize: vi.fn() }
    );

    const generationKey = mocks.episodeUpdate.mock.calls[0][0].data.audioGenerationKey as string;
    expect(generationKey).toMatch(/^[a-f0-9-]{36}$/);
    expect(mocks.admittedChildren).toHaveLength(2);
    for (const child of mocks.admittedChildren) {
      expect((child.payload as { audioGenerationKey: string }).audioGenerationKey).toBe(
        generationKey
      );
      expect(child.jobId).toContain(generationKey);
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

    const count = await restartExistingSegmentAudio('episode-1', 'replacement-attempt', {
      authorize: vi.fn(),
    });

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
    expect(mocks.admittedChildren).toHaveLength(2);
    expect(
      mocks.admittedChildren.map(
        (child) => (child.payload as { segmentVersion: number }).segmentVersion
      )
    ).toEqual([2, 4]);
    expect(
      mocks.admittedChildren.map(
        (child) => (child.payload as { audioGenerationKey: string }).audioGenerationKey
      )
    ).toEqual(['replacement-attempt', 'replacement-attempt']);
  });
});
