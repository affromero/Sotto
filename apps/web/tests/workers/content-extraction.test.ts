import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks (must be declared before any import that touches the modules) ----

const mockPrismaDiscoveryUpdate = vi.fn().mockResolvedValue({
  id: 'discovery-001',
  podcastId: 'podcast-001',
  sourceContent: '',
});
const mockPrismaDiscoveryFindUnique = vi.fn().mockResolvedValue(null);
const mockPrismaPodcastUpdate = vi.fn().mockResolvedValue({});

vi.mock('@/lib/prisma', () => ({
  get prismaUnfiltered() { return this.prisma; },
  prisma: {
    discovery: {
      update: (...args: unknown[]) => mockPrismaDiscoveryUpdate(...args),
      findUnique: (...args: unknown[]) => mockPrismaDiscoveryFindUnique(...args),
    },
    podcast: {
      update: (...args: unknown[]) => mockPrismaPodcastUpdate(...args),
    },
  },
}));

const mockExtractContent = vi.fn().mockResolvedValue({
  text: 'Extracted content from URL',
  markdown: '# Extracted\n\nContent from URL',
  title: 'Test Article',
  description: 'Test description',
  siteName: 'Example Site',
  author: 'Test Author',
  publishedDate: '2024-01-15T10:00:00Z',
  wordCount: 4,
  sourceType: 'html',
  extractionMethod: 'readability',
});

vi.mock('@/lib/extractors', () => ({
  extractContent: (...args: unknown[]) => mockExtractContent(...args),
}));

const mockAddJob = vi.fn().mockResolvedValue({ id: 'script-job-1' });

vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: {
    GENERATE_SCRIPT: 'generate_script',
  },
  scriptGenerationQueue: { name: 'script-generation' },
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
import { processContentExtraction } from '@/workers/content-extraction.worker';
import type { ExtractContentPayload } from '@/lib/queue';
import type { Job } from 'bullmq';

// ---- Helpers ----

function createMockJob(data: ExtractContentPayload): Job<ExtractContentPayload> {
  return {
    data,
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<ExtractContentPayload>;
}

const defaultPayload: ExtractContentPayload = {
  podcastId: 'podcast-001',
  userId: 'user-001',
  sourceUrl: undefined,
  sourceText: undefined,
};

// ---- Tests ----

describe('processContentExtraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrismaDiscoveryFindUnique.mockResolvedValue(null);
    mockPrismaDiscoveryUpdate.mockResolvedValue({
      id: 'discovery-001',
      podcastId: 'podcast-001',
      sourceContent: '# Extracted\n\nContent from URL',
    });
    mockPrismaPodcastUpdate.mockResolvedValue({});
    mockAddJob.mockResolvedValue({ id: 'script-job-1' });
    mockExtractContent.mockResolvedValue({
      text: 'Extracted content from URL',
      markdown: '# Extracted\n\nContent from URL',
      title: 'Test Article',
      description: 'Test description',
      siteName: 'Example Site',
      author: 'Test Author',
      publishedDate: '2024-01-15T10:00:00Z',
      wordCount: 4,
      sourceType: 'html',
      extractionMethod: 'readability',
    });
  });

  describe('URL extraction', () => {
    it('calls extractContent when sourceUrl is provided', async () => {
      const job = createMockJob({
        ...defaultPayload,
        sourceUrl: 'https://example.com/article',
      });
      await processContentExtraction(job);

      expect(mockExtractContent).toHaveBeenCalledWith('https://example.com/article');
    });

    it('stores markdown content from URL in discovery', async () => {
      mockExtractContent.mockResolvedValue({
        text: 'Plain text',
        markdown: '# Article\n\nThis is the extracted article content.',
        title: 'Article',
        siteName: null,
        author: null,
        publishedDate: null,
        wordCount: 7,
        sourceType: 'html',
        extractionMethod: 'readability',
      });
      const job = createMockJob({
        ...defaultPayload,
        sourceUrl: 'https://example.com/article',
      });
      await processContentExtraction(job);

      expect(mockPrismaDiscoveryUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceContent: '# Article\n\nThis is the extracted article content.',
          }),
        })
      );
    });
  });

  describe('metadata storage', () => {
    it('stores title, author, publishedDate, siteName in sourceMetadata', async () => {
      const job = createMockJob({
        ...defaultPayload,
        sourceUrl: 'https://example.com/article',
      });
      await processContentExtraction(job);

      expect(mockPrismaDiscoveryUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceMetadata: {
              title: 'Test Article',
              author: 'Test Author',
              publishedDate: '2024-01-15T10:00:00Z',
              siteName: 'Example Site',
              wordCount: 4,
              sourceType: 'html',
              extractionMethod: 'readability',
            },
          }),
        })
      );
    });

    it('does not include sourceMetadata when no URL provided', async () => {
      const job = createMockJob({
        ...defaultPayload,
        sourceText: 'User text',
      });
      await processContentExtraction(job);

      const updateCall = mockPrismaDiscoveryUpdate.mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty('sourceMetadata');
    });

    it('handles partial metadata (some fields null)', async () => {
      mockExtractContent.mockResolvedValue({
        text: 'Content',
        markdown: 'Content',
        title: 'Only Title',
        description: null,
        siteName: null,
        author: null,
        publishedDate: null,
        wordCount: 1,
        sourceType: 'html',
        extractionMethod: 'cheerio-fallback',
      });

      const job = createMockJob({
        ...defaultPayload,
        sourceUrl: 'https://example.com',
      });
      await processContentExtraction(job);

      expect(mockPrismaDiscoveryUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceMetadata: expect.objectContaining({
              title: 'Only Title',
              author: null,
              publishedDate: null,
              siteName: null,
            }),
          }),
        })
      );
    });
  });

  describe('text extraction', () => {
    it('uses sourceText directly when no sourceUrl is provided', async () => {
      const job = createMockJob({
        ...defaultPayload,
        sourceText: 'User-provided text content.',
      });
      await processContentExtraction(job);

      expect(mockExtractContent).not.toHaveBeenCalled();
      expect(mockPrismaDiscoveryUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceContent: 'User-provided text content.',
          }),
        })
      );
    });

    it('handles empty sourceText', async () => {
      const job = createMockJob({
        ...defaultPayload,
        sourceText: '',
      });
      await processContentExtraction(job);

      expect(mockPrismaDiscoveryUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceContent: '',
          }),
        })
      );
    });
  });

  describe('combining sourceText and sourceUrl', () => {
    it('combines sourceText and URL content when both are provided', async () => {
      mockExtractContent.mockResolvedValue({
        text: 'Content from URL',
        markdown: '# Article Content',
        title: 'Article',
        siteName: null,
        author: null,
        publishedDate: null,
        wordCount: 3,
        sourceType: 'html',
        extractionMethod: 'readability',
      });
      const job = createMockJob({
        ...defaultPayload,
        sourceUrl: 'https://example.com/article',
        sourceText: 'Thread discussion text here',
      });
      await processContentExtraction(job);

      expect(mockExtractContent).toHaveBeenCalledWith('https://example.com/article');
      expect(mockPrismaDiscoveryUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceContent: expect.stringContaining('Thread discussion text here'),
          }),
        })
      );
      // Should also contain the URL content
      const updateCall = mockPrismaDiscoveryUpdate.mock.calls[0][0];
      expect(updateCall.data.sourceContent).toContain('# Article Content');
      expect(updateCall.data.sourceContent).toContain('Referenced Article');
    });

    it('uses only URL content when sourceText is empty', async () => {
      mockExtractContent.mockResolvedValue({
        text: 'URL content',
        markdown: '# URL Content',
        title: null,
        siteName: null,
        author: null,
        publishedDate: null,
        wordCount: 2,
        sourceType: 'html',
        extractionMethod: 'readability',
      });
      const job = createMockJob({
        ...defaultPayload,
        sourceUrl: 'https://example.com/article',
        sourceText: '',
      });
      await processContentExtraction(job);

      expect(mockPrismaDiscoveryUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceContent: '# URL Content',
          }),
        })
      );
    });
  });

  describe('no source handling', () => {
    it('stores empty content when neither sourceUrl nor sourceText provided', async () => {
      const job = createMockJob(defaultPayload);
      await processContentExtraction(job);

      expect(mockExtractContent).not.toHaveBeenCalled();
      expect(mockPrismaDiscoveryUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceContent: '',
          }),
        })
      );
    });
  });

  describe('database updates', () => {
    it('updates podcast status to SCRIPTING', async () => {
      const job = createMockJob({
        ...defaultPayload,
        sourceText: 'Test content',
      });
      await processContentExtraction(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: { status: 'SCRIPTING' },
      });
    });
  });

  describe('pipeline chaining', () => {
    it('queues script generation job after extraction', async () => {
      mockPrismaDiscoveryUpdate.mockResolvedValue({
        id: 'discovery-abc',
        podcastId: 'podcast-001',
        sourceContent: 'Test content',
      });

      const job = createMockJob({
        ...defaultPayload,
        sourceText: 'Test content',
      });
      await processContentExtraction(job);

      expect(mockAddJob).toHaveBeenCalledWith({ name: 'script-generation' }, 'generate_script', {
        podcastId: 'podcast-001',
        userId: 'user-001',
        discoveryId: 'discovery-abc',
        sourceContent: 'Test content',
      });
    });

    it('passes undefined sourceContent when content is empty', async () => {
      mockPrismaDiscoveryUpdate.mockResolvedValue({
        id: 'discovery-empty',
        podcastId: 'podcast-001',
        sourceContent: '',
      });

      const job = createMockJob(defaultPayload);
      await processContentExtraction(job);

      expect(mockAddJob).toHaveBeenCalledWith(
        expect.anything(),
        'generate_script',
        expect.objectContaining({
          sourceContent: undefined,
        })
      );
    });
  });

  describe('job progress updates', () => {
    it('reports monotonically increasing progress ending at 100', async () => {
      const job = createMockJob({
        ...defaultPayload,
        sourceText: 'Test',
      });
      await processContentExtraction(job);

      const calls = (job.updateProgress as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => c[0]
      );
      for (let i = 1; i < calls.length; i++) {
        expect(calls[i]).toBeGreaterThanOrEqual(calls[i - 1] as number);
      }
      expect(calls[calls.length - 1]).toBe(100);
    });
  });

  describe('error propagation', () => {
    it('propagates errors from extractContent', async () => {
      mockExtractContent.mockRejectedValue(new Error('HTTP 404: Not Found'));
      const job = createMockJob({
        ...defaultPayload,
        sourceUrl: 'https://example.com/not-found',
      });

      await expect(processContentExtraction(job)).rejects.toThrow('HTTP 404');
    });

    it('propagates network errors from URL extraction', async () => {
      mockExtractContent.mockRejectedValue(new Error('Network timeout'));
      const job = createMockJob({
        ...defaultPayload,
        sourceUrl: 'https://example.com/slow',
      });

      await expect(processContentExtraction(job)).rejects.toThrow('Network timeout');
    });
  });

  describe('idempotency', () => {
    it('skips extraction when sourceContent already exists', async () => {
      mockPrismaDiscoveryFindUnique.mockResolvedValue({
        id: 'discovery-existing',
        sourceContent: 'Already extracted content',
      });

      const job = createMockJob({
        ...defaultPayload,
        sourceUrl: 'https://example.com/article',
      });
      await processContentExtraction(job);

      expect(mockExtractContent).not.toHaveBeenCalled();
      expect(mockPrismaDiscoveryUpdate).not.toHaveBeenCalled();
      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: { status: 'SCRIPTING' },
      });
      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'script-generation' },
        'generate_script',
        expect.objectContaining({
          podcastId: 'podcast-001',
          discoveryId: 'discovery-existing',
          sourceContent: 'Already extracted content',
        })
      );
    });

    it('proceeds normally when sourceContent is null', async () => {
      mockPrismaDiscoveryFindUnique.mockResolvedValue({
        id: 'discovery-001',
        sourceContent: null,
      });

      const job = createMockJob({
        ...defaultPayload,
        sourceText: 'User text',
      });
      await processContentExtraction(job);

      expect(mockPrismaDiscoveryUpdate).toHaveBeenCalled();
    });

    it('proceeds normally when discovery does not exist', async () => {
      mockPrismaDiscoveryFindUnique.mockResolvedValue(null);

      const job = createMockJob({
        ...defaultPayload,
        sourceText: 'User text',
      });
      await processContentExtraction(job);

      expect(mockPrismaDiscoveryUpdate).toHaveBeenCalled();
    });
  });
});
