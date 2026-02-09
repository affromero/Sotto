import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks (must be declared before any import that touches the modules) ----

const mockPrismaDiscoveryUpdate = vi.fn().mockResolvedValue({
  id: 'discovery-001',
  podcastId: 'podcast-001',
  sourceContent: '',
});
const mockPrismaPodcastUpdate = vi.fn().mockResolvedValue({});

vi.mock('@/lib/prisma', () => ({
  prisma: {
    discovery: {
      update: (...args: unknown[]) => mockPrismaDiscoveryUpdate(...args),
    },
    podcast: {
      update: (...args: unknown[]) => mockPrismaPodcastUpdate(...args),
    },
  },
}));

const mockExtractFromUrl = vi.fn().mockResolvedValue('Extracted content from URL');

vi.mock('@/lib/content-parser', () => ({
  extractFromUrl: (...args: unknown[]) => mockExtractFromUrl(...args),
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
    mockPrismaDiscoveryUpdate.mockResolvedValue({
      id: 'discovery-001',
      podcastId: 'podcast-001',
      sourceContent: 'Extracted content from URL',
    });
    mockPrismaPodcastUpdate.mockResolvedValue({});
    mockAddJob.mockResolvedValue({ id: 'script-job-1' });
    mockExtractFromUrl.mockResolvedValue('Extracted content from URL');
  });

  describe('URL extraction', () => {
    it('calls extractFromUrl when sourceUrl is provided', async () => {
      const job = createMockJob({
        ...defaultPayload,
        sourceUrl: 'https://example.com/article',
      });
      await processContentExtraction(job);

      expect(mockExtractFromUrl).toHaveBeenCalledWith('https://example.com/article');
    });

    it('stores extracted content from URL in discovery', async () => {
      mockExtractFromUrl.mockResolvedValue('This is the extracted article content.');
      const job = createMockJob({
        ...defaultPayload,
        sourceUrl: 'https://example.com/article',
      });
      await processContentExtraction(job);

      expect(mockPrismaDiscoveryUpdate).toHaveBeenCalledWith({
        where: { podcastId: 'podcast-001' },
        data: { sourceContent: 'This is the extracted article content.' },
      });
    });

    it('handles URLs with query parameters', async () => {
      const job = createMockJob({
        ...defaultPayload,
        sourceUrl: 'https://example.com/article?id=123&lang=en',
      });
      await processContentExtraction(job);

      expect(mockExtractFromUrl).toHaveBeenCalledWith('https://example.com/article?id=123&lang=en');
    });

    it('handles URLs with fragments', async () => {
      const job = createMockJob({
        ...defaultPayload,
        sourceUrl: 'https://example.com/article#section-2',
      });
      await processContentExtraction(job);

      expect(mockExtractFromUrl).toHaveBeenCalledWith('https://example.com/article#section-2');
    });

    it('handles long-form content from URL', async () => {
      const longContent = 'A'.repeat(50000);
      mockExtractFromUrl.mockResolvedValue(longContent);
      const job = createMockJob({
        ...defaultPayload,
        sourceUrl: 'https://example.com/long-article',
      });
      await processContentExtraction(job);

      expect(mockPrismaDiscoveryUpdate).toHaveBeenCalledWith({
        where: { podcastId: 'podcast-001' },
        data: { sourceContent: longContent },
      });
    });
  });

  describe('text extraction', () => {
    it('uses sourceText directly when no sourceUrl is provided', async () => {
      const job = createMockJob({
        ...defaultPayload,
        sourceText: 'User-provided text content.',
      });
      await processContentExtraction(job);

      expect(mockExtractFromUrl).not.toHaveBeenCalled();
      expect(mockPrismaDiscoveryUpdate).toHaveBeenCalledWith({
        where: { podcastId: 'podcast-001' },
        data: { sourceContent: 'User-provided text content.' },
      });
    });

    it('stores multiline text content', async () => {
      const multilineText = `Line 1
Line 2
Line 3`;
      const job = createMockJob({
        ...defaultPayload,
        sourceText: multilineText,
      });
      await processContentExtraction(job);

      expect(mockPrismaDiscoveryUpdate).toHaveBeenCalledWith({
        where: { podcastId: 'podcast-001' },
        data: { sourceContent: multilineText },
      });
    });

    it('handles empty sourceText', async () => {
      const job = createMockJob({
        ...defaultPayload,
        sourceText: '',
      });
      await processContentExtraction(job);

      expect(mockPrismaDiscoveryUpdate).toHaveBeenCalledWith({
        where: { podcastId: 'podcast-001' },
        data: { sourceContent: '' },
      });
    });
  });

  describe('priority handling', () => {
    it('prefers sourceUrl over sourceText when both are provided', async () => {
      mockExtractFromUrl.mockResolvedValue('Content from URL');
      const job = createMockJob({
        ...defaultPayload,
        sourceUrl: 'https://example.com/article',
        sourceText: 'User-provided text that should be ignored',
      });
      await processContentExtraction(job);

      expect(mockExtractFromUrl).toHaveBeenCalledWith('https://example.com/article');
      expect(mockPrismaDiscoveryUpdate).toHaveBeenCalledWith({
        where: { podcastId: 'podcast-001' },
        data: { sourceContent: 'Content from URL' },
      });
    });
  });

  describe('no source handling', () => {
    it('stores empty content when neither sourceUrl nor sourceText provided', async () => {
      const job = createMockJob(defaultPayload);
      await processContentExtraction(job);

      expect(mockExtractFromUrl).not.toHaveBeenCalled();
      expect(mockPrismaDiscoveryUpdate).toHaveBeenCalledWith({
        where: { podcastId: 'podcast-001' },
        data: { sourceContent: '' },
      });
    });
  });

  describe('database updates', () => {
    it('updates discovery with podcastId as the where clause', async () => {
      const job = createMockJob({
        ...defaultPayload,
        podcastId: 'podcast-xyz',
        sourceText: 'Test content',
      });
      await processContentExtraction(job);

      expect(mockPrismaDiscoveryUpdate).toHaveBeenCalledWith({
        where: { podcastId: 'podcast-xyz' },
        data: expect.any(Object),
      });
    });

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

    it('updates podcast status with correct podcast ID', async () => {
      const job = createMockJob({
        ...defaultPayload,
        podcastId: 'podcast-abc-123',
        sourceText: 'Test content',
      });
      await processContentExtraction(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-abc-123' },
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

    it('passes extracted URL content to script generation job', async () => {
      mockExtractFromUrl.mockResolvedValue('Content from the web');
      mockPrismaDiscoveryUpdate.mockResolvedValue({
        id: 'discovery-web',
        podcastId: 'podcast-002',
        sourceContent: 'Content from the web',
      });

      const job = createMockJob({
        ...defaultPayload,
        podcastId: 'podcast-002',
        userId: 'user-002',
        sourceUrl: 'https://example.com/article',
      });
      await processContentExtraction(job);

      expect(mockAddJob).toHaveBeenCalledWith(
        expect.anything(),
        'generate_script',
        expect.objectContaining({
          sourceContent: 'Content from the web',
        })
      );
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

    it('includes discoveryId from the discovery update response', async () => {
      mockPrismaDiscoveryUpdate.mockResolvedValue({
        id: 'discovery-specific-123',
        podcastId: 'podcast-001',
        sourceContent: 'Test',
      });

      const job = createMockJob({
        ...defaultPayload,
        sourceText: 'Test',
      });
      await processContentExtraction(job);

      expect(mockAddJob).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          discoveryId: 'discovery-specific-123',
        })
      );
    });
  });

  describe('job progress updates', () => {
    it('reports progress at 10% after starting', async () => {
      const job = createMockJob({
        ...defaultPayload,
        sourceText: 'Test',
      });
      await processContentExtraction(job);

      expect(job.updateProgress).toHaveBeenCalledWith(10);
    });

    it('reports progress at 50% after content extraction', async () => {
      const job = createMockJob({
        ...defaultPayload,
        sourceText: 'Test',
      });
      await processContentExtraction(job);

      expect(job.updateProgress).toHaveBeenCalledWith(50);
    });

    it('reports progress at 100% at the end', async () => {
      const job = createMockJob({
        ...defaultPayload,
        sourceText: 'Test',
      });
      await processContentExtraction(job);

      expect(job.updateProgress).toHaveBeenCalledWith(100);
    });

    it('reports progress in the correct order', async () => {
      const job = createMockJob({
        ...defaultPayload,
        sourceText: 'Test',
      });
      await processContentExtraction(job);

      const progressCalls = (job.updateProgress as ReturnType<typeof vi.fn>).mock.calls.map(
        (call: number[]) => call[0]
      );
      expect(progressCalls).toEqual([10, 50, 100]);
    });
  });

  describe('error propagation', () => {
    it('propagates errors from extractFromUrl', async () => {
      mockExtractFromUrl.mockRejectedValue(new Error('Failed to fetch URL: 404'));
      const job = createMockJob({
        ...defaultPayload,
        sourceUrl: 'https://example.com/not-found',
      });

      await expect(processContentExtraction(job)).rejects.toThrow('Failed to fetch URL: 404');
    });

    it('propagates network errors from URL extraction', async () => {
      mockExtractFromUrl.mockRejectedValue(new Error('Network timeout'));
      const job = createMockJob({
        ...defaultPayload,
        sourceUrl: 'https://example.com/slow',
      });

      await expect(processContentExtraction(job)).rejects.toThrow('Network timeout');
    });

    it('propagates errors from prisma discovery update', async () => {
      mockPrismaDiscoveryUpdate.mockRejectedValue(
        new Error('Discovery record not found for podcast')
      );
      const job = createMockJob({
        ...defaultPayload,
        sourceText: 'Test',
      });

      await expect(processContentExtraction(job)).rejects.toThrow(
        'Discovery record not found for podcast'
      );
    });

    it('propagates errors from prisma podcast update', async () => {
      mockPrismaPodcastUpdate.mockRejectedValue(new Error('Podcast not found'));
      const job = createMockJob({
        ...defaultPayload,
        sourceText: 'Test',
      });

      await expect(processContentExtraction(job)).rejects.toThrow('Podcast not found');
    });

    it('propagates errors from addJob', async () => {
      mockPrismaPodcastUpdate.mockResolvedValueOnce({});
      mockAddJob.mockRejectedValue(new Error('Queue connection failed'));
      const job = createMockJob({
        ...defaultPayload,
        sourceText: 'Test',
      });

      await expect(processContentExtraction(job)).rejects.toThrow('Queue connection failed');
    });
  });

  describe('edge cases', () => {
    it('handles invalid URL format errors', async () => {
      mockExtractFromUrl.mockRejectedValue(new Error('Invalid URL'));
      const job = createMockJob({
        ...defaultPayload,
        sourceUrl: 'not-a-valid-url',
      });

      await expect(processContentExtraction(job)).rejects.toThrow('Invalid URL');
    });

    it('handles very long sourceText', async () => {
      const veryLongText = 'X'.repeat(100000);
      const job = createMockJob({
        ...defaultPayload,
        sourceText: veryLongText,
      });
      await processContentExtraction(job);

      expect(mockPrismaDiscoveryUpdate).toHaveBeenCalledWith({
        where: { podcastId: 'podcast-001' },
        data: { sourceContent: veryLongText },
      });
    });

    it('handles special characters in sourceText', async () => {
      const specialText = 'Text with emoji 🎧 and symbols <>&"';
      const job = createMockJob({
        ...defaultPayload,
        sourceText: specialText,
      });
      await processContentExtraction(job);

      expect(mockPrismaDiscoveryUpdate).toHaveBeenCalledWith({
        where: { podcastId: 'podcast-001' },
        data: { sourceContent: specialText },
      });
    });

    it('handles Unicode characters in sourceText', async () => {
      const unicodeText = 'こんにちは world 你好 мир';
      const job = createMockJob({
        ...defaultPayload,
        sourceText: unicodeText,
      });
      await processContentExtraction(job);

      expect(mockPrismaDiscoveryUpdate).toHaveBeenCalledWith({
        where: { podcastId: 'podcast-001' },
        data: { sourceContent: unicodeText },
      });
    });
  });

  describe('end-to-end flow', () => {
    it('executes the full pipeline for URL extraction', async () => {
      mockExtractFromUrl.mockResolvedValue('Article about AI and machine learning.');
      mockPrismaDiscoveryUpdate.mockResolvedValue({
        id: 'discovery-e2e-1',
        podcastId: 'podcast-e2e-1',
        sourceContent: 'Article about AI and machine learning.',
      });

      const job = createMockJob({
        podcastId: 'podcast-e2e-1',
        userId: 'user-e2e-1',
        sourceUrl: 'https://example.com/ai-article',
      });
      await processContentExtraction(job);

      // URL extracted
      expect(mockExtractFromUrl).toHaveBeenCalledWith('https://example.com/ai-article');

      // Discovery updated
      expect(mockPrismaDiscoveryUpdate).toHaveBeenCalledWith({
        where: { podcastId: 'podcast-e2e-1' },
        data: { sourceContent: 'Article about AI and machine learning.' },
      });

      // Podcast status updated
      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-e2e-1' },
        data: { status: 'SCRIPTING' },
      });

      // Script generation queued
      expect(mockAddJob).toHaveBeenCalledWith({ name: 'script-generation' }, 'generate_script', {
        podcastId: 'podcast-e2e-1',
        userId: 'user-e2e-1',
        discoveryId: 'discovery-e2e-1',
        sourceContent: 'Article about AI and machine learning.',
      });

      // Progress tracked
      expect(job.updateProgress).toHaveBeenCalledWith(10);
      expect(job.updateProgress).toHaveBeenCalledWith(50);
      expect(job.updateProgress).toHaveBeenCalledWith(100);
    });

    it('executes the full pipeline for text extraction', async () => {
      mockPrismaDiscoveryUpdate.mockResolvedValue({
        id: 'discovery-e2e-2',
        podcastId: 'podcast-e2e-2',
        sourceContent: 'User typed this directly into the chat interface.',
      });

      const job = createMockJob({
        podcastId: 'podcast-e2e-2',
        userId: 'user-e2e-2',
        sourceText: 'User typed this directly into the chat interface.',
      });
      await processContentExtraction(job);

      // No URL extraction
      expect(mockExtractFromUrl).not.toHaveBeenCalled();

      // Discovery updated with sourceText
      expect(mockPrismaDiscoveryUpdate).toHaveBeenCalledWith({
        where: { podcastId: 'podcast-e2e-2' },
        data: { sourceContent: 'User typed this directly into the chat interface.' },
      });

      // Podcast status updated
      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-e2e-2' },
        data: { status: 'SCRIPTING' },
      });

      // Script generation queued
      expect(mockAddJob).toHaveBeenCalledWith({ name: 'script-generation' }, 'generate_script', {
        podcastId: 'podcast-e2e-2',
        userId: 'user-e2e-2',
        discoveryId: 'discovery-e2e-2',
        sourceContent: 'User typed this directly into the chat interface.',
      });
    });

    it('executes the full pipeline with no source content', async () => {
      mockPrismaDiscoveryUpdate.mockResolvedValue({
        id: 'discovery-e2e-3',
        podcastId: 'podcast-e2e-3',
        sourceContent: '',
      });

      const job = createMockJob({
        podcastId: 'podcast-e2e-3',
        userId: 'user-e2e-3',
      });
      await processContentExtraction(job);

      // Discovery updated with empty content
      expect(mockPrismaDiscoveryUpdate).toHaveBeenCalledWith({
        where: { podcastId: 'podcast-e2e-3' },
        data: { sourceContent: '' },
      });

      // Podcast status updated
      expect(mockPrismaPodcastUpdate).toHaveBeenCalled();

      // Script generation queued with undefined sourceContent
      expect(mockAddJob).toHaveBeenCalledWith(
        expect.anything(),
        'generate_script',
        expect.objectContaining({
          sourceContent: undefined,
        })
      );
    });
  });
});
