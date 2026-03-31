import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockPodcastFindUnique = vi.fn();
const mockPodcastFindUniqueOrThrow = vi.fn();
const mockPodcastUpdate = vi.fn().mockResolvedValue({});
const mockPodcastUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const mockDiscoveryFindUnique = vi.fn();
const mockScriptFindUnique = vi.fn();
const mockReferenceFindMany = vi.fn();
const mockSegmentFindMany = vi.fn();
const mockResearchDossierFindUnique = vi.fn();
const mockCreativeOutlineFindUnique = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
      findUniqueOrThrow: (...args: unknown[]) => mockPodcastFindUniqueOrThrow(...args),
      update: (...args: unknown[]) => mockPodcastUpdate(...args),
      updateMany: (...args: unknown[]) => mockPodcastUpdateMany(...args),
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

// ---- Import under test ----
import { markPodcastFailed, determineResumePoint } from '@/lib/pipeline-resume';

// ---- Tests ----

describe('markPodcastFailed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records failedAtStatus and sets status to FAILED via CAS', async () => {
    mockPodcastFindUnique.mockResolvedValue({ status: 'GENERATING_AUDIO' });

    await markPodcastFailed('podcast-001');

    expect(mockPodcastUpdateMany).toHaveBeenCalledWith({
      where: { id: 'podcast-001', status: 'GENERATING_AUDIO' },
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

  it('skips if podcast is already FAILED (idempotent)', async () => {
    mockPodcastFindUnique.mockResolvedValue({ status: 'FAILED' });

    await markPodcastFailed('podcast-001');

    expect(mockPodcastUpdateMany).not.toHaveBeenCalled();
  });

  it('skips if podcast is READY', async () => {
    mockPodcastFindUnique.mockResolvedValue({ status: 'READY' });

    await markPodcastFailed('podcast-001');

    expect(mockPodcastUpdateMany).not.toHaveBeenCalled();
  });

  it('skips if podcast is SCRIPT_READY', async () => {
    mockPodcastFindUnique.mockResolvedValue({ status: 'SCRIPT_READY' });

    await markPodcastFailed('podcast-001');

    expect(mockPodcastUpdateMany).not.toHaveBeenCalled();
  });

  it('skips if podcast not found', async () => {
    mockPodcastFindUnique.mockResolvedValue(null);

    await markPodcastFailed('nonexistent');

    expect(mockPodcastUpdateMany).not.toHaveBeenCalled();
  });

  it('returns false when CAS loses (status changed between read and write)', async () => {
    mockPodcastFindUnique.mockResolvedValue({ status: 'GENERATING_AUDIO' });
    mockPodcastUpdateMany.mockResolvedValue({ count: 0 });

    const result = await markPodcastFailed('podcast-001');

    expect(result).toBe(false);
    expect(mockPodcastUpdateMany).toHaveBeenCalled();
  });

  it('persists errorId when provided', async () => {
    mockPodcastFindUnique.mockResolvedValue({ status: 'GENERATING_AUDIO' });

    await markPodcastFailed('podcast-003', {
      failureReason: 'TTS provider error',
      errorId: 'err_abc123def456',
    });

    expect(mockPodcastUpdateMany).toHaveBeenCalledWith({
      where: { id: 'podcast-003', status: 'GENERATING_AUDIO' },
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
    mockPodcastFindUnique.mockResolvedValue({ status: 'SCRIPTING' });

    await markPodcastFailed('podcast-004', { failureReason: 'Script error' });

    expect(mockPodcastUpdateMany).toHaveBeenCalledWith({
      where: { id: 'podcast-004', status: 'SCRIPTING' },
      data: expect.objectContaining({
        errorId: null,
      }),
    });
  });

  it('records STITCHING as failedAtStatus when failing during stitching', async () => {
    mockPodcastFindUnique.mockResolvedValue({ status: 'STITCHING' });

    await markPodcastFailed('podcast-002');

    expect(mockPodcastUpdateMany).toHaveBeenCalledWith({
      where: { id: 'podcast-002', status: 'STITCHING' },
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
    mockPodcastFindUniqueOrThrow.mockResolvedValue({
      source: 'WEB',
      failedAtStatus: null,
      importedAudioKey: null,
    });
    mockDiscoveryFindUnique.mockResolvedValue(null);
    mockScriptFindUnique.mockResolvedValue(null);
    mockReferenceFindMany.mockResolvedValue([]);
    mockSegmentFindMany.mockResolvedValue([]);
    mockResearchDossierFindUnique.mockResolvedValue(null);
    mockCreativeOutlineFindUnique.mockResolvedValue(null);
  });

  it('returns IMPORT_AUDIO for import source podcasts', async () => {
    mockPodcastFindUniqueOrThrow.mockResolvedValue({
      source: 'IMPORT',
      failedAtStatus: 'IMPORTING',
      importedAudioKey: 'uploads/audio.mp3',
    });

    const result = await determineResumePoint('podcast-001');

    expect(result).toEqual({ step: 'IMPORT_AUDIO' });
  });

  it('returns STITCH_AUDIO when all segments have audioUrl', async () => {
    mockSegmentFindMany.mockResolvedValue([
      { id: 'seg-1', audioUrl: 'https://cdn.example.com/seg1.mp3' },
      { id: 'seg-2', audioUrl: 'https://cdn.example.com/seg2.mp3' },
      { id: 'seg-3', audioUrl: 'https://cdn.example.com/seg3.mp3' },
    ]);

    const result = await determineResumePoint('podcast-001');

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

    const result = await determineResumePoint('podcast-001');

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

    const result = await determineResumePoint('podcast-001');

    expect(result).toEqual({ step: 'SCRIPT_READY' });
  });

  it('returns COMPILE_SCRIPT when script exists but no segments', async () => {
    mockScriptFindUnique.mockResolvedValue({
      turns: [{ speaker: 'HOST', text: 'Hello' }],
    });

    const result = await determineResumePoint('podcast-001');

    expect(result).toEqual({ step: 'COMPILE_SCRIPT' });
  });

  it('returns WRITE_SCRIPT when creative outline exists but no script', async () => {
    mockCreativeOutlineFindUnique.mockResolvedValue({ id: 'outline-001' });

    const result = await determineResumePoint('podcast-001');

    expect(result).toEqual({ step: 'WRITE_SCRIPT' });
  });

  it('returns CREATIVE_PLANNING when research dossier exists but no outline', async () => {
    mockResearchDossierFindUnique.mockResolvedValue({ id: 'dossier-001' });

    const result = await determineResumePoint('podcast-001');

    expect(result).toEqual({ step: 'CREATIVE_PLANNING' });
  });

  it('returns DEEP_RESEARCH when discovery has sourceContent but no dossier', async () => {
    mockDiscoveryFindUnique.mockResolvedValue({
      sourceContent: 'Extracted article content...',
    });

    const result = await determineResumePoint('podcast-001');

    expect(result).toEqual({ step: 'DEEP_RESEARCH' });
  });

  it('returns EXTRACT_CONTENT when nothing exists', async () => {
    const result = await determineResumePoint('podcast-001');

    expect(result).toEqual({ step: 'EXTRACT_CONTENT' });
  });

  it('returns EXTRACT_CONTENT when discovery has no sourceContent', async () => {
    mockDiscoveryFindUnique.mockResolvedValue({ sourceContent: null });

    const result = await determineResumePoint('podcast-001');

    expect(result).toEqual({ step: 'EXTRACT_CONTENT' });
  });

  it('returns EXTRACT_CONTENT when discovery has empty sourceContent', async () => {
    mockDiscoveryFindUnique.mockResolvedValue({ sourceContent: '' });

    const result = await determineResumePoint('podcast-001');

    expect(result).toEqual({ step: 'EXTRACT_CONTENT' });
  });
});
