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
      verificationAttempts: 1,
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
      verificationAttempts: 1,
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

  it('returns SCRIPT_READY when all refs validated and no segments', async () => {
    mockScriptFindUnique.mockResolvedValue({
      turns: [{ speaker: 'HOST', text: 'Hello' }],
      verificationAttempts: 1,
    });
    mockReferenceFindMany.mockResolvedValue([
      { id: 'ref-1', verificationStatus: 'VERIFIED' },
      { id: 'ref-2', verificationStatus: 'REPLACED' },
    ]);

    const result = await determineResumePoint('podcast-001');

    expect(result).toEqual({ step: 'SCRIPT_READY' });
  });

  it('returns VALIDATE_REFERENCES when some refs still PENDING', async () => {
    mockScriptFindUnique.mockResolvedValue({
      turns: [{ speaker: 'HOST', text: 'Hello' }],
      verificationAttempts: 1,
    });
    mockReferenceFindMany.mockResolvedValue([
      { id: 'ref-1', verificationStatus: 'VERIFIED' },
      { id: 'ref-2', verificationStatus: 'PENDING' },
    ]);

    const result = await determineResumePoint('podcast-001');

    expect(result).toEqual({ step: 'VALIDATE_REFERENCES' });
  });

  it('returns GENERATE_SCRIPT when script failed verification 3x with no validated refs', async () => {
    mockScriptFindUnique.mockResolvedValue({
      turns: [{ speaker: 'HOST', text: 'Bad script' }],
      verificationAttempts: 3,
    });
    // All refs still PENDING (or no refs at all)
    mockReferenceFindMany.mockResolvedValue([]);

    const result = await determineResumePoint('podcast-001');

    expect(result).toEqual({ step: 'GENERATE_SCRIPT' });
  });

  it('preserves script that passed on 3rd attempt with validated refs', async () => {
    mockScriptFindUnique.mockResolvedValue({
      turns: [{ speaker: 'HOST', text: 'Good script on 3rd try' }],
      verificationAttempts: 3,
    });
    mockReferenceFindMany.mockResolvedValue([
      { id: 'ref-1', verificationStatus: 'VERIFIED' },
    ]);

    const result = await determineResumePoint('podcast-001');

    // Should NOT return GENERATE_SCRIPT — the script was good
    expect(result).toEqual({ step: 'SCRIPT_READY' });
  });

  it('returns VERIFY_SCRIPT when script exists but never verified', async () => {
    mockScriptFindUnique.mockResolvedValue({
      turns: [{ speaker: 'HOST', text: 'New script' }],
      verificationAttempts: 0,
    });

    const result = await determineResumePoint('podcast-001');

    expect(result).toEqual({ step: 'VERIFY_SCRIPT' });
  });

  it('returns VERIFY_SCRIPT when mid-verification (1 attempt, all refs PENDING)', async () => {
    mockScriptFindUnique.mockResolvedValue({
      turns: [{ speaker: 'HOST', text: 'Script' }],
      verificationAttempts: 1,
    });
    mockReferenceFindMany.mockResolvedValue([
      { id: 'ref-1', verificationStatus: 'PENDING' },
    ]);

    const result = await determineResumePoint('podcast-001');

    expect(result).toEqual({ step: 'VERIFY_SCRIPT' });
  });

  it('returns VERIFY_SCRIPT when mid-verification (2 attempts)', async () => {
    mockScriptFindUnique.mockResolvedValue({
      turns: [{ speaker: 'HOST', text: 'Script' }],
      verificationAttempts: 2,
    });
    mockReferenceFindMany.mockResolvedValue([]);

    const result = await determineResumePoint('podcast-001');

    expect(result).toEqual({ step: 'VERIFY_SCRIPT' });
  });

  it('returns GENERATE_SCRIPT when discovery has sourceContent but no script', async () => {
    mockDiscoveryFindUnique.mockResolvedValue({
      sourceContent: 'Extracted article content...',
    });

    const result = await determineResumePoint('podcast-001');

    expect(result).toEqual({ step: 'GENERATE_SCRIPT' });
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
