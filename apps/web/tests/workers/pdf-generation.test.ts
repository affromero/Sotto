import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks (must be declared before any import that touches the modules) ----

const mockPrismaPodcastFindUniqueOrThrow = vi.fn().mockResolvedValue({
  id: 'podcast-001',
  title: 'Introduction to Quantum Computing',
  topic: 'Quantum Computing Basics',
  createdAt: new Date('2024-01-15T10:00:00Z'),
  user: { name: 'Alice Researcher' },
  segments: [
    { speaker: 'HOST', text: 'Welcome to our podcast on quantum computing [1].' },
    { speaker: 'EXPERT', text: 'Thanks for having me. Quantum bits are fascinating [2, 3].' },
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

const mockPrismaPodcastUpdate = vi.fn().mockResolvedValue({});

vi.mock('@/lib/prisma', () => ({
  prisma: {
    podcast: {
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaPodcastFindUniqueOrThrow(...args),
      update: (...args: unknown[]) => mockPrismaPodcastUpdate(...args),
    },
  },
}));

const mockGeneratePodcastPdf = vi.fn().mockResolvedValue(Buffer.from('fake-pdf-content'));

vi.mock('@/lib/pdf-generator', () => ({
  generatePodcastPdf: (...args: unknown[]) => mockGeneratePodcastPdf(...args),
}));

const mockUploadFile = vi
  .fn()
  .mockResolvedValue('https://r2.example.com/podcasts/podcast-001/transcript.pdf');

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
    data: { userId: 'user-1', podcastId: 'podcast-001', ...data } as GeneratePdfPayload,
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<GeneratePdfPayload>;
}

const defaultPayload: GeneratePdfPayload = {
  podcastId: 'podcast-001',
  userId: 'user-123',
};

// ---- Tests ----

describe('processPdfGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset default mock implementations
    mockPrismaPodcastUpdate.mockResolvedValue({});
    mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
      id: 'podcast-001',
      title: 'Introduction to Quantum Computing',
      topic: 'Quantum Computing Basics',
      createdAt: new Date('2024-01-15T10:00:00Z'),
      user: { name: 'Alice Researcher' },
      segments: [
        { speaker: 'HOST', text: 'Welcome to our podcast on quantum computing [1].' },
        { speaker: 'EXPERT', text: 'Thanks for having me. Quantum bits are fascinating [2, 3].' },
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
    mockGeneratePodcastPdf.mockResolvedValue(Buffer.from('fake-pdf-content'));
    mockUploadFile.mockResolvedValue('https://r2.example.com/podcasts/podcast-001/transcript.pdf');
  });

  describe('podcast lookup', () => {
    it('handles missing podcast', async () => {
      mockPrismaPodcastFindUniqueOrThrow.mockRejectedValue(new Error('No Podcast found'));
      const job = createMockJob(defaultPayload);

      await expect(processPdfGeneration(job)).rejects.toThrow('No Podcast found');
    });

  });

  describe('PDF generation', () => {
    it('calls generatePodcastPdf with complete podcast data', async () => {
      const job = createMockJob(defaultPayload);
      await processPdfGeneration(job);

      expect(mockGeneratePodcastPdf).toHaveBeenCalledWith({
        title: 'Introduction to Quantum Computing',
        topic: 'Quantum Computing Basics',
        creatorName: 'Alice Researcher',
        createdAt: new Date('2024-01-15T10:00:00Z'),
        segments: [
          { speaker: 'HOST', text: 'Welcome to our podcast on quantum computing [1].' },
          { speaker: 'EXPERT', text: 'Thanks for having me. Quantum bits are fascinating [2, 3].' },
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
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        id: 'podcast-001',
        title: 'Test Podcast',
        topic: 'Test Topic',
        createdAt: new Date('2024-01-15T10:00:00Z'),
        user: { name: null },
        segments: [],
        references: [],
      });
      const job = createMockJob(defaultPayload);
      await processPdfGeneration(job);

      expect(mockGeneratePodcastPdf).toHaveBeenCalledWith(
        expect.objectContaining({
          creatorName: 'Anonymous',
        })
      );
    });

    it('handles podcasts with no segments', async () => {
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        id: 'podcast-001',
        title: 'Empty Podcast',
        topic: 'No Content',
        createdAt: new Date('2024-01-15T10:00:00Z'),
        user: { name: 'Test User' },
        segments: [],
        references: [],
      });
      const job = createMockJob(defaultPayload);
      await processPdfGeneration(job);

      expect(mockGeneratePodcastPdf).toHaveBeenCalledWith(
        expect.objectContaining({
          segments: [],
        })
      );
    });

    it('handles podcasts with no references', async () => {
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        id: 'podcast-001',
        title: 'No References Podcast',
        topic: 'Opinion Piece',
        createdAt: new Date('2024-01-15T10:00:00Z'),
        user: { name: 'Test User' },
        segments: [{ speaker: 'HOST', text: 'This is my opinion.' }],
        references: [],
      });
      const job = createMockJob(defaultPayload);
      await processPdfGeneration(job);

      expect(mockGeneratePodcastPdf).toHaveBeenCalledWith(
        expect.objectContaining({
          references: [],
        })
      );
    });

    it('maps all reference fields including verificationDetails', async () => {
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        id: 'podcast-001',
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
          },
        ],
      });
      const job = createMockJob(defaultPayload);
      await processPdfGeneration(job);

      expect(mockGeneratePodcastPdf).toHaveBeenCalledWith(
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
            },
          ],
        })
      );
    });

    it('handles generation failure', async () => {
      mockGeneratePodcastPdf.mockRejectedValue(new Error('pdfmake rendering failed'));
      const job = createMockJob(defaultPayload);

      await expect(processPdfGeneration(job)).rejects.toThrow('pdfmake rendering failed');
    });
  });

  describe('R2 upload', () => {
    it('uploads PDF buffer to R2 with correct key and content type', async () => {
      const pdfBuffer = Buffer.from('actual-pdf-bytes-xyz');
      mockGeneratePodcastPdf.mockResolvedValue(pdfBuffer);
      const job = createMockJob(defaultPayload);
      await processPdfGeneration(job);

      expect(mockUploadFile).toHaveBeenCalledWith(
        'podcasts/podcast-001/transcript.pdf',
        pdfBuffer,
        'application/pdf'
      );
    });

    it('uses the exact buffer from generatePodcastPdf', async () => {
      const specificBuffer = Buffer.from('specific-pdf-content-abcdef123456');
      mockGeneratePodcastPdf.mockResolvedValue(specificBuffer);
      const job = createMockJob(defaultPayload);
      await processPdfGeneration(job);

      const uploadedBuffer = mockUploadFile.mock.calls[0][1];
      expect(uploadedBuffer).toBe(specificBuffer);
    });

    it('constructs R2 key with podcastId', async () => {
      const job = createMockJob({ podcastId: 'podcast-special-123', userId: 'user-123' });
      await processPdfGeneration(job);

      expect(mockUploadFile).toHaveBeenCalledWith(
        'podcasts/podcast-special-123/transcript.pdf',
        expect.any(Buffer),
        'application/pdf'
      );
    });

    it('handles R2 upload failure', async () => {
      mockUploadFile.mockRejectedValue(new Error('R2 storage quota exceeded'));
      const job = createMockJob(defaultPayload);

      await expect(processPdfGeneration(job)).rejects.toThrow('R2 storage quota exceeded');
    });
  });

  describe('database updates', () => {
    it('updates podcast with pdfUrl from R2', async () => {
      mockUploadFile.mockResolvedValue('https://cdn.sotto.fm/podcasts/001/transcript.pdf');
      const job = createMockJob(defaultPayload);
      await processPdfGeneration(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: { pdfUrl: 'https://cdn.sotto.fm/podcasts/001/transcript.pdf' },
      });
    });

    it('uses the exact pdfUrl returned by uploadFile', async () => {
      mockUploadFile.mockResolvedValue('https://custom-cdn.example.com/path/to/file.pdf');
      const job = createMockJob(defaultPayload);
      await processPdfGeneration(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: { pdfUrl: 'https://custom-cdn.example.com/path/to/file.pdf' },
      });
    });

    it('handles database update failure', async () => {
      mockPrismaPodcastUpdate.mockRejectedValue(new Error('Database connection lost'));
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
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        id: 'podcast-e2e',
        title: 'End to End Test',
        topic: 'Testing',
        createdAt: new Date('2024-02-01T15:30:00Z'),
        user: { name: 'E2E Tester' },
        segments: [
          { speaker: 'HOST', text: 'Intro segment [1].' },
          { speaker: 'EXPERT', text: 'Response segment [2].' },
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

      const pdfBuffer = Buffer.from('complete-e2e-pdf-content');
      mockGeneratePodcastPdf.mockResolvedValue(pdfBuffer);
      mockUploadFile.mockResolvedValue(
        'https://r2.example.com/podcasts/podcast-e2e/transcript.pdf'
      );

      const job = createMockJob({ podcastId: 'podcast-e2e', userId: 'user-123' });
      await processPdfGeneration(job);

      // Podcast loaded
      expect(mockPrismaPodcastFindUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'podcast-e2e' },
        include: expect.any(Object),
      });

      // PDF generated with correct data
      expect(mockGeneratePodcastPdf).toHaveBeenCalledWith({
        title: 'End to End Test',
        topic: 'Testing',
        creatorName: 'E2E Tester',
        createdAt: new Date('2024-02-01T15:30:00Z'),
        segments: [
          { speaker: 'HOST', text: 'Intro segment [1].' },
          { speaker: 'EXPERT', text: 'Response segment [2].' },
        ],
        references: expect.arrayContaining([
          expect.objectContaining({ id: 'ref-e2e-1', number: 1 }),
          expect.objectContaining({ id: 'ref-e2e-2', number: 2 }),
        ]),
      });

      // Uploaded to R2
      expect(mockUploadFile).toHaveBeenCalledWith(
        'podcasts/podcast-e2e/transcript.pdf',
        pdfBuffer,
        'application/pdf'
      );

      // Podcast updated
      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-e2e' },
        data: { pdfUrl: 'https://r2.example.com/podcasts/podcast-e2e/transcript.pdf' },
      });

      // Progress tracked
      expect(job.updateProgress).toHaveBeenCalledTimes(5);
    });
  });

  describe('error propagation', () => {
    it('propagates errors from podcast lookup', async () => {
      mockPrismaPodcastFindUniqueOrThrow.mockRejectedValue(
        new Error('Podcast not found: podcast-missing')
      );
      const job = createMockJob({ podcastId: 'podcast-missing', userId: 'user-123' });

      await expect(processPdfGeneration(job)).rejects.toThrow('Podcast not found: podcast-missing');
    });

    it('propagates errors from generatePodcastPdf', async () => {
      mockGeneratePodcastPdf.mockRejectedValue(new Error('PDF rendering failed: out of memory'));
      const job = createMockJob(defaultPayload);

      await expect(processPdfGeneration(job)).rejects.toThrow(
        'PDF rendering failed: out of memory'
      );
    });

    it('propagates errors from uploadFile', async () => {
      mockUploadFile.mockRejectedValue(new Error('S3 403: access denied'));
      const job = createMockJob(defaultPayload);

      await expect(processPdfGeneration(job)).rejects.toThrow('S3 403: access denied');
    });

    it('propagates errors from podcast update', async () => {
      mockPrismaPodcastUpdate.mockRejectedValue(
        new Error('Unique constraint violation: pdfUrl already set')
      );
      const job = createMockJob(defaultPayload);

      await expect(processPdfGeneration(job)).rejects.toThrow(
        'Unique constraint violation: pdfUrl already set'
      );
    });

    it('does not swallow unexpected errors', async () => {
      mockPrismaPodcastFindUniqueOrThrow.mockRejectedValue(new Error('Unexpected database error'));
      const job = createMockJob(defaultPayload);

      await expect(processPdfGeneration(job)).rejects.toThrow('Unexpected database error');
    });
  });
});
