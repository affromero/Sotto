import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks (must be declared before any import that touches the modules) ----

const mockPrismaEpisodeFindUniqueOrThrow = vi.fn().mockResolvedValue({
  id: 'episode-001',
  title: 'Introduction to Quantum Computing',
  topic: 'Quantum Computing Basics',
  createdAt: new Date('2024-01-15T10:00:00Z'),
  user: { name: 'Alice Researcher' },
  segments: [
    { speaker: 'HOST', text: 'Welcome to our episode on quantum computing [1].', startTime: 0 },
    { speaker: 'EXPERT', text: 'Thanks for having me. Quantum bits are fascinating [2, 3].', startTime: 45 },
  ],
  references: [
    {
      id: 'ref-1',
      number: 1,
      title: 'Introduction to Quantum Computing',
      authors: ['John Smith', 'Jane Doe'],
      year: 2023,
      url: 'https://example.com/quantum-intro',
      type: 'ARTICLE',
      publisher: 'Nature',
      doi: '10.1038/nature12345',
      verificationStatus: 'VERIFIED',
      verificationDetails: null,
    },
    {
      id: 'ref-2',
      number: 2,
      title: 'Quantum Bits and Their Applications',
      authors: ['Bob Wilson'],
      year: 2022,
      url: 'https://example.com/qubits',
      type: 'BOOK',
      publisher: null,
      doi: null,
      verificationStatus: 'VERIFIED',
      verificationDetails: null,
    },
    {
      id: 'ref-3',
      number: 3,
      title: 'Advanced Quantum Theory',
      authors: [],
      year: null,
      url: 'https://example.com/advanced',
      type: 'WEBPAGE',
      publisher: null,
      doi: null,
      verificationStatus: 'UNVERIFIED',
      verificationDetails: null,
    },
  ],
});

const mockPrismaEpisodeUpdate = vi.fn().mockResolvedValue({});

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    episode: {
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaEpisodeFindUniqueOrThrow(...args),
      update: (...args: unknown[]) => mockPrismaEpisodeUpdate(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

const mockGenerateEpisodeTranscript = vi.fn().mockReturnValue('# Fake Transcript\n\nContent here.');

vi.mock('@/lib/pdf-generator', () => ({
  generateEpisodeTranscript: (...args: unknown[]) => mockGenerateEpisodeTranscript(...args),
}));

const mockUploadFile = vi
  .fn()
  .mockResolvedValue('https://r2.example.com/episodes/episode-001/transcript.md');

vi.mock('@/lib/r2', () => ({
  uploadFile: (...args: unknown[]) => mockUploadFile(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---- Import under test ----
import { processPdfGeneration } from '@/workers/pdf-generation.worker';
import type { GeneratePdfPayload } from '@/lib/queue';
import type { Job } from 'bullmq';

// ---- Helpers ----

function createMockJob(data: Partial<GeneratePdfPayload>): Job<GeneratePdfPayload> {
  return {
    data: { userId: 'user-1', episodeId: 'episode-001', ...data } as GeneratePdfPayload,
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<GeneratePdfPayload>;
}

const defaultPayload: GeneratePdfPayload = {
  episodeId: 'episode-001',
  userId: 'user-123',
};

// ---- Tests ----

describe('processPdfGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset default mock implementations
    mockPrismaEpisodeUpdate.mockResolvedValue({});
    mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
      id: 'episode-001',
      title: 'Introduction to Quantum Computing',
      topic: 'Quantum Computing Basics',
      createdAt: new Date('2024-01-15T10:00:00Z'),
      user: { name: 'Alice Researcher' },
      segments: [
        { speaker: 'HOST', text: 'Welcome to our episode on quantum computing [1].', startTime: 0 },
        { speaker: 'EXPERT', text: 'Thanks for having me. Quantum bits are fascinating [2, 3].', startTime: 45 },
      ],
      references: [
        {
          id: 'ref-1',
          number: 1,
          title: 'Introduction to Quantum Computing',
          authors: ['John Smith', 'Jane Doe'],
          year: 2023,
          url: 'https://example.com/quantum-intro',
          type: 'ARTICLE',
          publisher: 'Nature',
          doi: '10.1038/nature12345',
          verificationStatus: 'VERIFIED',
          verificationDetails: null,
        },
      ],
    });
    mockGenerateEpisodeTranscript.mockReturnValue('# Fake Transcript\n\nContent here.');
    mockUploadFile.mockResolvedValue('https://r2.example.com/episodes/episode-001/transcript.md');
  });

  describe('episode lookup', () => {
    it('handles missing episode', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockRejectedValue(new Error('No Episode found'));
      const job = createMockJob(defaultPayload);

      await expect(processPdfGeneration(job)).rejects.toThrow('No Episode found');
    });

    it('includes startTime in segment select', async () => {
      const job = createMockJob(defaultPayload);
      await processPdfGeneration(job);

      expect(mockPrismaEpisodeFindUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'episode-001' },
        include: expect.objectContaining({
          segments: expect.objectContaining({
            select: { speaker: true, text: true, startTime: true },
          }),
        }),
      });
    });
  });

  describe('transcript generation', () => {
    it('calls generateEpisodeTranscript with complete episode data', async () => {
      const job = createMockJob(defaultPayload);
      await processPdfGeneration(job);

      expect(mockGenerateEpisodeTranscript).toHaveBeenCalledWith({
        title: 'Introduction to Quantum Computing',
        topic: 'Quantum Computing Basics',
        creatorName: 'Alice Researcher',
        createdAt: new Date('2024-01-15T10:00:00Z'),
        segments: [
          { speaker: 'HOST', text: 'Welcome to our episode on quantum computing [1].', startTime: 0 },
          { speaker: 'EXPERT', text: 'Thanks for having me. Quantum bits are fascinating [2, 3].', startTime: 45 },
        ],
        references: expect.arrayContaining([
          expect.objectContaining({
            id: 'ref-1',
            number: 1,
            title: 'Introduction to Quantum Computing',
            authors: ['John Smith', 'Jane Doe'],
            year: 2023,
            url: 'https://example.com/quantum-intro',
            type: 'ARTICLE',
            publisher: 'Nature',
            doi: '10.1038/nature12345',
            verificationStatus: 'VERIFIED',
          }),
        ]),
      });
    });

    it('uses Anonymous when user name is null', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
        id: 'episode-001',
        title: 'Test Episode',
        topic: 'Test Topic',
        createdAt: new Date('2024-01-15T10:00:00Z'),
        user: { name: null },
        segments: [],
        references: [],
      });
      const job = createMockJob(defaultPayload);
      await processPdfGeneration(job);

      expect(mockGenerateEpisodeTranscript).toHaveBeenCalledWith(
        expect.objectContaining({
          creatorName: 'Anonymous',
        })
      );
    });

    it('handles episodes with no segments', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
        id: 'episode-001',
        title: 'Empty Episode',
        topic: 'No Content',
        createdAt: new Date('2024-01-15T10:00:00Z'),
        user: { name: 'Test User' },
        segments: [],
        references: [],
      });
      const job = createMockJob(defaultPayload);
      await processPdfGeneration(job);

      expect(mockGenerateEpisodeTranscript).toHaveBeenCalledWith(
        expect.objectContaining({
          segments: [],
        })
      );
    });

    it('handles episodes with no references', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
        id: 'episode-001',
        title: 'No References Episode',
        topic: 'Opinion Piece',
        createdAt: new Date('2024-01-15T10:00:00Z'),
        user: { name: 'Test User' },
        segments: [{ speaker: 'HOST', text: 'This is my opinion.', startTime: 0 }],
        references: [],
      });
      const job = createMockJob(defaultPayload);
      await processPdfGeneration(job);

      expect(mockGenerateEpisodeTranscript).toHaveBeenCalledWith(
        expect.objectContaining({
          references: [],
        })
      );
    });

    it('maps all reference fields including verificationDetails', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
        id: 'episode-001',
        title: 'Test',
        topic: 'Test',
        createdAt: new Date('2024-01-15T10:00:00Z'),
        user: { name: 'Test' },
        segments: [],
        references: [
          {
            id: 'ref-full',
            number: 5,
            title: 'Complete Reference',
            authors: ['Author One', 'Author Two'],
            year: 2021,
            url: 'https://example.com/ref',
            type: 'BOOK',
            publisher: 'Academic Press',
            doi: '10.1234/doi5678',
            verificationStatus: 'VERIFIED',
            verificationDetails: { source: 'crossref', confidence: 0.95 },
            contentDomain: null,
          },
        ],
      });
      const job = createMockJob(defaultPayload);
      await processPdfGeneration(job);

      expect(mockGenerateEpisodeTranscript).toHaveBeenCalledWith(
        expect.objectContaining({
          references: [
            {
              id: 'ref-full',
              number: 5,
              title: 'Complete Reference',
              authors: ['Author One', 'Author Two'],
              year: 2021,
              url: 'https://example.com/ref',
              type: 'BOOK',
              publisher: 'Academic Press',
              doi: '10.1234/doi5678',
              verificationStatus: 'VERIFIED',
              verificationDetails: { source: 'crossref', confidence: 0.95 },
              contentDomain: null,
            },
          ],
        })
      );
    });
  });

  describe('R2 upload', () => {
    it('uploads markdown buffer to R2 with correct key and content type', async () => {
      const markdown = '# Test Transcript\n\nContent.';
      mockGenerateEpisodeTranscript.mockReturnValue(markdown);
      const job = createMockJob(defaultPayload);
      await processPdfGeneration(job);

      expect(mockUploadFile).toHaveBeenCalledWith(
        'episodes/episode-001/transcript.md',
        Buffer.from(markdown, 'utf-8'),
        'text/markdown'
      );
    });

    it('constructs R2 key with episodeId', async () => {
      const job = createMockJob({ episodeId: 'episode-special-123', userId: 'user-123' });
      await processPdfGeneration(job);

      expect(mockUploadFile).toHaveBeenCalledWith(
        'episodes/episode-special-123/transcript.md',
        expect.any(Buffer),
        'text/markdown'
      );
    });

    it('handles R2 upload failure', async () => {
      mockUploadFile.mockRejectedValue(new Error('R2 storage quota exceeded'));
      const job = createMockJob(defaultPayload);

      await expect(processPdfGeneration(job)).rejects.toThrow('R2 storage quota exceeded');
    });
  });

  describe('database updates', () => {
    it('updates episode with pdfUrl from R2', async () => {
      mockUploadFile.mockResolvedValue('https://media.example.com/episodes/001/transcript.md');
      const job = createMockJob(defaultPayload);
      await processPdfGeneration(job);

      expect(mockPrismaEpisodeUpdate).toHaveBeenCalledWith({
        where: { id: 'episode-001' },
        data: { pdfUrl: 'https://media.example.com/episodes/001/transcript.md' },
      });
    });

    it('uses the exact pdfUrl returned by uploadFile', async () => {
      mockUploadFile.mockResolvedValue('https://custom-cdn.example.com/path/to/file.md');
      const job = createMockJob(defaultPayload);
      await processPdfGeneration(job);

      expect(mockPrismaEpisodeUpdate).toHaveBeenCalledWith({
        where: { id: 'episode-001' },
        data: { pdfUrl: 'https://custom-cdn.example.com/path/to/file.md' },
      });
    });

    it('handles database update failure', async () => {
      mockPrismaEpisodeUpdate.mockRejectedValue(new Error('Database connection lost'));
      const job = createMockJob(defaultPayload);

      await expect(processPdfGeneration(job)).rejects.toThrow('Database connection lost');
    });
  });

  describe('progress tracking', () => {
    it('reports monotonically increasing progress ending at 100', async () => {
      const job = createMockJob(defaultPayload);
      await processPdfGeneration(job);

      const calls = (job.updateProgress as ReturnType<typeof vi.fn>).mock.calls.map((c: any[]) => c[0]);
      for (let i = 1; i < calls.length; i++) {
        expect(calls[i]).toBeGreaterThanOrEqual(calls[i - 1]);
      }
      expect(calls[calls.length - 1]).toBe(100);
    });
  });

  describe('end-to-end flow', () => {
    it('executes the full pipeline successfully', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockResolvedValue({
        id: 'episode-e2e',
        title: 'End to End Test',
        topic: 'Testing',
        createdAt: new Date('2024-02-01T15:30:00Z'),
        user: { name: 'E2E Tester' },
        segments: [
          { speaker: 'HOST', text: 'Intro segment [1].', startTime: 0 },
          { speaker: 'EXPERT', text: 'Response segment [2].', startTime: 30 },
        ],
        references: [
          {
            id: 'ref-e2e-1',
            number: 1,
            title: 'E2E Reference One',
            authors: ['Author A'],
            year: 2024,
            url: 'https://example.com/ref1',
            type: 'ARTICLE',
            publisher: null,
            doi: null,
            verificationStatus: 'VERIFIED',
            verificationDetails: null,
          },
          {
            id: 'ref-e2e-2',
            number: 2,
            title: 'E2E Reference Two',
            authors: ['Author B', 'Author C'],
            year: 2023,
            url: 'https://example.com/ref2',
            type: 'BOOK',
            publisher: 'E2E Press',
            doi: '10.5678/e2e',
            verificationStatus: 'VERIFIED',
            verificationDetails: null,
          },
        ],
      });

      const markdown = '# End to End Test\n\nTranscript content.';
      mockGenerateEpisodeTranscript.mockReturnValue(markdown);
      mockUploadFile.mockResolvedValue(
        'https://r2.example.com/episodes/episode-e2e/transcript.md'
      );

      const job = createMockJob({ episodeId: 'episode-e2e', userId: 'user-123' });
      await processPdfGeneration(job);

      // Episode loaded
      expect(mockPrismaEpisodeFindUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'episode-e2e' },
        include: expect.any(Object),
      });

      // Transcript generated with correct data
      expect(mockGenerateEpisodeTranscript).toHaveBeenCalledWith({
        title: 'End to End Test',
        topic: 'Testing',
        creatorName: 'E2E Tester',
        createdAt: new Date('2024-02-01T15:30:00Z'),
        segments: [
          { speaker: 'HOST', text: 'Intro segment [1].', startTime: 0 },
          { speaker: 'EXPERT', text: 'Response segment [2].', startTime: 30 },
        ],
        references: expect.arrayContaining([
          expect.objectContaining({ id: 'ref-e2e-1', number: 1 }),
          expect.objectContaining({ id: 'ref-e2e-2', number: 2 }),
        ]),
      });

      // Uploaded to R2 as markdown
      expect(mockUploadFile).toHaveBeenCalledWith(
        'episodes/episode-e2e/transcript.md',
        Buffer.from(markdown, 'utf-8'),
        'text/markdown'
      );

      // Episode updated
      expect(mockPrismaEpisodeUpdate).toHaveBeenCalledWith({
        where: { id: 'episode-e2e' },
        data: { pdfUrl: 'https://r2.example.com/episodes/episode-e2e/transcript.md' },
      });

      // Progress tracked
      expect(job.updateProgress).toHaveBeenCalled();
    });
  });

  describe('error propagation', () => {
    it('propagates errors from episode lookup', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockRejectedValue(
        new Error('Episode not found: episode-missing')
      );
      const job = createMockJob({ episodeId: 'episode-missing', userId: 'user-123' });

      await expect(processPdfGeneration(job)).rejects.toThrow('Episode not found: episode-missing');
    });

    it('propagates errors from uploadFile', async () => {
      mockUploadFile.mockRejectedValue(new Error('S3 403: access denied'));
      const job = createMockJob(defaultPayload);

      await expect(processPdfGeneration(job)).rejects.toThrow('S3 403: access denied');
    });

    it('propagates errors from episode update', async () => {
      mockPrismaEpisodeUpdate.mockRejectedValue(
        new Error('Unique constraint violation: pdfUrl already set')
      );
      const job = createMockJob(defaultPayload);

      await expect(processPdfGeneration(job)).rejects.toThrow(
        'Unique constraint violation: pdfUrl already set'
      );
    });

    it('does not swallow unexpected errors', async () => {
      mockPrismaEpisodeFindUniqueOrThrow.mockRejectedValue(new Error('Unexpected database error'));
      const job = createMockJob(defaultPayload);

      await expect(processPdfGeneration(job)).rejects.toThrow('Unexpected database error');
    });
  });
});
