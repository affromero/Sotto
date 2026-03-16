import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockPodcastDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
const mockPodcastFindMany = vi.fn().mockResolvedValue([]);
const mockVideoGenerationUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
const mockAvatarOverlayUpdateMany = vi.fn().mockResolvedValue({ count: 0 });

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    podcast: {
      deleteMany: (...args: unknown[]) => mockPodcastDeleteMany(...args),
      findMany: (...args: unknown[]) => mockPodcastFindMany(...args),
    },
    videoGeneration: {
      updateMany: (...args: unknown[]) => mockVideoGenerationUpdateMany(...args),
    },
    avatarOverlay: {
      updateMany: (...args: unknown[]) => mockAvatarOverlayUpdateMany(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

const mockMarkPodcastFailed = vi.fn().mockResolvedValue(true);
vi.mock('@/lib/pipeline-resume', () => ({
  markPodcastFailed: (...args: unknown[]) => mockMarkPodcastFailed(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---- Import under test ----
import { processDraftCleanup } from '@/workers/draft-cleanup.worker';

// ---- Helpers ----

function createMockJob() {
  return {
    data: {},
    updateProgress: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// ---- Tests ----

describe('processDraftCleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes stale draft podcasts', async () => {
    await processDraftCleanup(createMockJob());

    expect(mockPodcastDeleteMany).toHaveBeenCalledWith({
      where: {
        status: 'DRAFT',
        updatedAt: { lt: expect.any(Date) },
      },
    });
  });

  it('marks stale video generations as FAILED', async () => {
    await processDraftCleanup(createMockJob());

    expect(mockVideoGenerationUpdateMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['PENDING', 'CLASSIFYING', 'GENERATING_VISUALS', 'GENERATING_AVATARS', 'COMPOSING'] },
        updatedAt: { lt: expect.any(Date) },
      },
      data: {
        status: 'FAILED',
        failureReason: expect.stringContaining('20 minutes'),
      },
    });
  });

  it('marks stale avatar overlays as failed', async () => {
    await processDraftCleanup(createMockJob());

    expect(mockAvatarOverlayUpdateMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['concatenating', 'submitting', 'processing'] },
        updatedAt: { lt: expect.any(Date) },
      },
      data: {
        status: 'failed',
        failureReason: expect.stringContaining('30 minutes'),
      },
    });
  });

  it('reaps podcasts stuck in active pipeline states for >2 hours', async () => {
    const stuckPodcast = { id: 'stuck-001', status: 'GENERATING_AUDIO' };
    mockPodcastFindMany.mockResolvedValue([stuckPodcast]);

    await processDraftCleanup(createMockJob());

    expect(mockPodcastFindMany).toHaveBeenCalledWith({
      where: {
        status: {
          in: [
            'EXTRACTING', 'SCRIPTING', 'VERIFYING_SCRIPT',
            'VALIDATING_REFERENCES', 'GENERATING_AUDIO', 'STITCHING',
            'UPDATING', 'IMPORTING', 'TRANSCRIBING',
          ],
        },
        updatedAt: { lt: expect.any(Date) },
      },
      select: { id: true, status: true },
    });

    expect(mockMarkPodcastFailed).toHaveBeenCalledWith('stuck-001', {
      failureReason: 'Generation timed out. Please try again.',
      technicalError: 'Orphan reaper: stuck in GENERATING_AUDIO for >2h',
    });
  });

  it('does not call markPodcastFailed when no stale pipelines exist', async () => {
    mockPodcastFindMany.mockResolvedValue([]);

    await processDraftCleanup(createMockJob());

    expect(mockMarkPodcastFailed).not.toHaveBeenCalled();
  });

  it('reaps multiple stuck podcasts in different states', async () => {
    const stuckPodcasts = [
      { id: 'stuck-001', status: 'EXTRACTING' },
      { id: 'stuck-002', status: 'STITCHING' },
      { id: 'stuck-003', status: 'IMPORTING' },
    ];
    mockPodcastFindMany.mockResolvedValue(stuckPodcasts);

    await processDraftCleanup(createMockJob());

    expect(mockMarkPodcastFailed).toHaveBeenCalledTimes(3);
    expect(mockMarkPodcastFailed).toHaveBeenCalledWith('stuck-001', expect.objectContaining({
      technicalError: 'Orphan reaper: stuck in EXTRACTING for >2h',
    }));
    expect(mockMarkPodcastFailed).toHaveBeenCalledWith('stuck-002', expect.objectContaining({
      technicalError: 'Orphan reaper: stuck in STITCHING for >2h',
    }));
    expect(mockMarkPodcastFailed).toHaveBeenCalledWith('stuck-003', expect.objectContaining({
      technicalError: 'Orphan reaper: stuck in IMPORTING for >2h',
    }));
  });
});
