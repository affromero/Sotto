import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockEpisodeFindUnique = vi.fn();
const mockEpisodeFindUniqueOrThrow = vi.fn();
const mockEpisodeUpdate = vi.fn().mockResolvedValue({});
const mockEpisodeUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const mockDiscoveryFindUnique = vi.fn();
const mockScriptFindUnique = vi.fn();
const mockReferenceFindMany = vi.fn();
const mockSegmentFindMany = vi.fn();
const mockResearchDossierFindUnique = vi.fn();
const mockCreativeOutlineFindUnique = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    episode: {
      findUnique: (...args: unknown[]) => mockEpisodeFindUnique(...args),
      findUniqueOrThrow: (...args: unknown[]) => mockEpisodeFindUniqueOrThrow(...args),
      update: (...args: unknown[]) => mockEpisodeUpdate(...args),
      updateMany: (...args: unknown[]) => mockEpisodeUpdateMany(...args),
    },
    discovery: {
      findUnique: (...args: unknown[]) => mockDiscoveryFindUnique(...args),
    },
    script: {
      findUnique: (...args: unknown[]) => mockScriptFindUnique(...args),
    },
    reference: {
      findMany: (...args: unknown[]) => mockReferenceFindMany(...args),
    },
    segment: {
      findMany: (...args: unknown[]) => mockSegmentFindMany(...args),
    },
    researchDossier: {
      findUnique: (...args: unknown[]) => mockResearchDossierFindUnique(...args),
    },
    creativeOutline: {
      findUnique: (...args: unknown[]) => mockCreativeOutlineFindUnique(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/redis', () => ({
  invalidateEpisodeCache: vi.fn().mockResolvedValue(undefined),
  publishEpisodeStatus: vi.fn().mockResolvedValue(undefined),
}));

// ---- Import under test ----
import { markEpisodeFailed, determineResumePoint } from '@/lib/pipeline-resume';

// ---- Tests ----

describe('markEpisodeFailed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records failedAtStatus and sets status to FAILED via CAS', async () => {
    mockEpisodeFindUnique.mockResolvedValue({ status: 'GENERATING_AUDIO' });

    await markEpisodeFailed('episode-001');

    expect(mockEpisodeUpdateMany).toHaveBeenCalledWith({
      where: { id: 'episode-001', status: 'GENERATING_AUDIO' },
      data: {
        status: 'FAILED',
        failedAtStatus: 'GENERATING_AUDIO',
        failureReason: null,
        technicalError: null,
        errorId: null,
        failedAt: expect.any(Date),
      },
    });
  });

  it('skips if episode is already FAILED (idempotent)', async () => {
    mockEpisodeFindUnique.mockResolvedValue({ status: 'FAILED' });

    await markEpisodeFailed('episode-001');

    expect(mockEpisodeUpdateMany).not.toHaveBeenCalled();
  });

  it('skips if episode is READY', async () => {
    mockEpisodeFindUnique.mockResolvedValue({ status: 'READY' });

    await markEpisodeFailed('episode-001');

    expect(mockEpisodeUpdateMany).not.toHaveBeenCalled();
  });

  it('skips if episode is SCRIPT_READY', async () => {
    mockEpisodeFindUnique.mockResolvedValue({ status: 'SCRIPT_READY' });

    await markEpisodeFailed('episode-001');

    expect(mockEpisodeUpdateMany).not.toHaveBeenCalled();
  });

  it('skips if episode not found', async () => {
    mockEpisodeFindUnique.mockResolvedValue(null);

    await markEpisodeFailed('nonexistent');

    expect(mockEpisodeUpdateMany).not.toHaveBeenCalled();
  });

  it('returns false when CAS loses (status changed between read and write)', async () => {
    mockEpisodeFindUnique.mockResolvedValue({ status: 'GENERATING_AUDIO' });
    mockEpisodeUpdateMany.mockResolvedValue({ count: 0 });

    const result = await markEpisodeFailed('episode-001');

    expect(result).toBe(false);
    expect(mockEpisodeUpdateMany).toHaveBeenCalled();
  });

  it('persists errorId when provided', async () => {
    mockEpisodeFindUnique.mockResolvedValue({ status: 'GENERATING_AUDIO' });

    await markEpisodeFailed('episode-003', {
      failureReason: 'TTS provider error',
      errorId: 'err_abc123def456',
    });

    expect(mockEpisodeUpdateMany).toHaveBeenCalledWith({
      where: { id: 'episode-003', status: 'GENERATING_AUDIO' },
      data: {
        status: 'FAILED',
        failedAtStatus: 'GENERATING_AUDIO',
        failureReason: 'TTS provider error',
        technicalError: null,
        errorId: 'err_abc123def456',
        failedAt: expect.any(Date),
      },
    });
  });

  it('sets errorId to null when not provided', async () => {
    mockEpisodeFindUnique.mockResolvedValue({ status: 'SCRIPTING' });

    await markEpisodeFailed('episode-004', { failureReason: 'Script error' });

    expect(mockEpisodeUpdateMany).toHaveBeenCalledWith({
      where: { id: 'episode-004', status: 'SCRIPTING' },
      data: expect.objectContaining({
        errorId: null,
      }),
    });
  });

  it('records STITCHING as failedAtStatus when failing during stitching', async () => {
    mockEpisodeFindUnique.mockResolvedValue({ status: 'STITCHING' });

    await markEpisodeFailed('episode-002');

    expect(mockEpisodeUpdateMany).toHaveBeenCalledWith({
      where: { id: 'episode-002', status: 'STITCHING' },
      data: {
        status: 'FAILED',
        failedAtStatus: 'STITCHING',
        failureReason: null,
        technicalError: null,
        errorId: null,
        failedAt: expect.any(Date),
      },
    });
  });
});

describe('determineResumePoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Defaults: nothing exists
    mockEpisodeFindUniqueOrThrow.mockResolvedValue({
      source: 'WEB',
      failedAtStatus: null,
    });
    mockDiscoveryFindUnique.mockResolvedValue(null);
    mockScriptFindUnique.mockResolvedValue(null);
    mockReferenceFindMany.mockResolvedValue([]);
    mockSegmentFindMany.mockResolvedValue([]);
    mockResearchDossierFindUnique.mockResolvedValue(null);
    mockCreativeOutlineFindUnique.mockResolvedValue(null);
  });

  it('returns STITCH_AUDIO when all segments have audioUrl', async () => {
    mockSegmentFindMany.mockResolvedValue([
      { id: 'seg-1', audioUrl: 'https://cdn.example.com/seg1.mp3' },
      { id: 'seg-2', audioUrl: 'https://cdn.example.com/seg2.mp3' },
      { id: 'seg-3', audioUrl: 'https://cdn.example.com/seg3.mp3' },
    ]);

    const result = await determineResumePoint('episode-001');

    expect(result).toEqual({
      step: 'STITCH_AUDIO',
      segmentIds: ['seg-1', 'seg-2', 'seg-3'],
    });
  });

  it('returns GENERATE_AUDIO with pending segment IDs when some segments lack audio', async () => {
    mockScriptFindUnique.mockResolvedValue({
      turns: [
        { speaker: 'HOST', text: 'Hello' },
        { speaker: 'EXPERT', text: 'Hi' },
        { speaker: 'HOST', text: 'Bye' },
      ],
    });
    mockSegmentFindMany.mockResolvedValue([
      { id: 'seg-1', audioUrl: 'https://cdn.example.com/seg1.mp3' },
      { id: 'seg-2', audioUrl: null },
      { id: 'seg-3', audioUrl: null },
    ]);

    const result = await determineResumePoint('episode-001');

    expect(result).toEqual({
      step: 'GENERATE_AUDIO',
      pendingSegmentIds: ['seg-2', 'seg-3'],
    });
  });

  it('returns SCRIPT_READY when segment count mismatches script turns', async () => {
    mockScriptFindUnique.mockResolvedValue({
      turns: [
        { speaker: 'HOST', text: 'Hello' },
        { speaker: 'EXPERT', text: 'Hi' },
      ],
    });
    // 3 segments but only 2 script turns → stale segments
    mockSegmentFindMany.mockResolvedValue([
      { id: 'seg-1', audioUrl: 'https://cdn.example.com/seg1.mp3' },
      { id: 'seg-2', audioUrl: null },
      { id: 'seg-3', audioUrl: null },
    ]);

    const result = await determineResumePoint('episode-001');

    expect(result).toEqual({ step: 'SCRIPT_READY' });
  });

  it('returns COMPILE_SCRIPT when script exists but no segments', async () => {
    mockScriptFindUnique.mockResolvedValue({
      turns: [{ speaker: 'HOST', text: 'Hello' }],
    });

    const result = await determineResumePoint('episode-001');

    expect(result).toEqual({ step: 'COMPILE_SCRIPT' });
  });

  it('returns WRITE_SCRIPT when creative outline exists but no script', async () => {
    mockCreativeOutlineFindUnique.mockResolvedValue({ id: 'outline-001' });

    const result = await determineResumePoint('episode-001');

    expect(result).toEqual({ step: 'WRITE_SCRIPT' });
  });

  it('returns CREATIVE_PLANNING when research dossier exists but no outline', async () => {
    mockResearchDossierFindUnique.mockResolvedValue({ id: 'dossier-001' });

    const result = await determineResumePoint('episode-001');

    expect(result).toEqual({ step: 'CREATIVE_PLANNING' });
  });

  it('returns DEEP_RESEARCH when discovery has sourceContent but no dossier', async () => {
    mockDiscoveryFindUnique.mockResolvedValue({
      sourceContent: 'Extracted article content...',
    });

    const result = await determineResumePoint('episode-001');

    expect(result).toEqual({ step: 'DEEP_RESEARCH' });
  });

  it('returns EXTRACT_CONTENT when nothing exists', async () => {
    const result = await determineResumePoint('episode-001');

    expect(result).toEqual({ step: 'EXTRACT_CONTENT' });
  });

  it('returns EXTRACT_CONTENT when discovery has no sourceContent', async () => {
    mockDiscoveryFindUnique.mockResolvedValue({ sourceContent: null });

    const result = await determineResumePoint('episode-001');

    expect(result).toEqual({ step: 'EXTRACT_CONTENT' });
  });

  it('returns EXTRACT_CONTENT when discovery has empty sourceContent', async () => {
    mockDiscoveryFindUnique.mockResolvedValue({ sourceContent: '' });

    const result = await determineResumePoint('episode-001');

    expect(result).toEqual({ step: 'EXTRACT_CONTENT' });
  });
});
