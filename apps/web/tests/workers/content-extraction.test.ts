import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks (must be declared before any import that touches the modules) ----

const mockPrismaDiscoveryUpdate = vi.fn().mockResolvedValue({
  id: 'discovery-001',
  podcastId: 'podcast-001',
  sourceContent: '',
});
const mockPrismaDiscoveryFindUnique = vi.fn().mockResolvedValue(null);
const mockPrismaPodcastUpdate = vi.fn().mockResolvedValue({});
const mockPrismaPodcastFindUniqueOrThrow = vi.fn().mockResolvedValue({
  source: 'WEB',
  aiModel: 'gpt-5-mini',
  user: {},
});

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    discovery: {
      update: (...args: unknown[]) => mockPrismaDiscoveryUpdate(...args),
      findUnique: (...args: unknown[]) => mockPrismaDiscoveryFindUnique(...args),
    },
    podcast: {
      update: (...args: unknown[]) => mockPrismaPodcastUpdate(...args),
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaPodcastFindUniqueOrThrow(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

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
    DEEP_RESEARCH: 'deep_research',
  },
  deepResearchQueue: { name: 'deep-research' },
}));

vi.mock('@/lib/pipeline-events', () => ({
  logPipelineStageComplete: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockAssessTopicFeasibility = vi.fn().mockResolvedValue({
  verdict: 'proceed',
  reason: 'Topic is feasible',
  suggestion: null,
  inputTokens: 0,
  outputTokens: 0,
  model: 'test',
});

vi.mock('@/lib/topic-assessor', () => ({
  assessTopicFeasibility: (...args: unknown[]) => mockAssessTopicFeasibility(...args),
}));

vi.mock('@/lib/pipeline-resume', () => ({
  markPodcastFailed: vi.fn().mockResolvedValue(undefined),
}));

const mockInvalidatePodcastCache = vi.fn().mockResolvedValue(undefined);
const mockPublishPodcastStatus = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/redis', () => ({
  invalidatePodcastCache: (...args: unknown[]) => mockInvalidatePodcastCache(...args),
  publishPodcastStatus: (...args: unknown[]) => mockPublishPodcastStatus(...args),
}));

const mockLogUsage = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/usage-logger', () => ({
  logUsage: (...args: unknown[]) => mockLogUsage(...args),
}));

const mockGetAiKey = vi.fn().mockResolvedValue({ apiKey: 'provider-key', provider: 'openai' });

vi.mock('@/lib/byok', () => ({
  getAiKey: (...args: unknown[]) => mockGetAiKey(...args),
}));

const mockResolveAiModelAndProvider = vi.fn().mockResolvedValue({
  model: 'gpt-5-mini',
  provider: 'openai',
});

vi.mock('@/lib/providers/ai-registry', () => ({
  resolveAiModelAndProvider: (...args: unknown[]) => mockResolveAiModelAndProvider(...args),
}));

vi.mock('@/lib/media-bias', () => ({
  analyzeBias: vi.fn().mockReturnValue({ biasLevel: 'low', confidence: 0.9 }),
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
    mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
      source: 'WEB',
      aiModel: 'gpt-5-mini',
      user: {},
    });
    mockAddJob.mockResolvedValue({ id: 'script-job-1' });
    mockAssessTopicFeasibility.mockResolvedValue({
      verdict: 'proceed',
      reason: 'Topic is feasible',
      suggestion: null,
      inputTokens: 0,
      outputTokens: 0,
      model: 'test',
    });
    mockLogUsage.mockResolvedValue(undefined);
    mockGetAiKey.mockResolvedValue({ apiKey: 'provider-key', provider: 'openai' });
    mockResolveAiModelAndProvider.mockResolvedValue({ model: 'gpt-5-mini', provider: 'openai' });
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

    it('stores tables and figures in sourceMetadata when extraction returns them', async () => {
      mockExtractContent.mockResolvedValue({
        text: 'Revenue data',
        markdown: '# Revenue\n\nData here',
        title: 'Revenue Report',
        description: null,
        siteName: null,
        author: null,
        publishedDate: null,
        wordCount: 2,
        sourceType: 'html',
        extractionMethod: 'readability',
        tables: [{ caption: 'Q1-Q4', headers: ['Quarter', 'Revenue'], rows: [['Q1', '$10M']], sourceLabel: null }],
        figures: [{ url: 'https://example.com/chart.png', caption: 'Figure 1', altText: null, sourceLabel: null, mimeType: 'image/png' }],
      });

      const job = createMockJob({
        ...defaultPayload,
        sourceUrl: 'https://example.com/data',
      });
      await processContentExtraction(job);

      expect(mockPrismaDiscoveryUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceMetadata: expect.objectContaining({
              tables: [{ caption: 'Q1-Q4', headers: ['Quarter', 'Revenue'], rows: [['Q1', '$10M']], sourceLabel: null }],
              figures: [{ url: 'https://example.com/chart.png', caption: 'Figure 1', altText: null, sourceLabel: null, mimeType: 'image/png' }],
            }),
          }),
        })
      );
    });

    it('omits structured data fields from sourceMetadata when extraction returns none', async () => {
      const job = createMockJob({
        ...defaultPayload,
        sourceUrl: 'https://example.com/article',
      });
      await processContentExtraction(job);

      const updateCall = mockPrismaDiscoveryUpdate.mock.calls[0][0];
      const metadata = updateCall.data.sourceMetadata as Record<string, unknown>;
      expect(metadata).not.toHaveProperty('tables');
      expect(metadata).not.toHaveProperty('figures');
      expect(metadata).not.toHaveProperty('keyStatistics');
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

  describe('topic feasibility AI routing', () => {
    beforeEach(() => {
      mockPrismaDiscoveryFindUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          topic: 'Private podcast infrastructure',
          depth: 'standard',
          focusAreas: [],
        });
    });

    it('uses the podcast model owner and matching provider key', async () => {
      const job = createMockJob({
        ...defaultPayload,
        sourceText: 'Source material',
      });
      await processContentExtraction(job);

      expect(mockResolveAiModelAndProvider).toHaveBeenCalledWith({
        podcastAiModel: 'gpt-5-mini',
        aiKey: null,
      });
      expect(mockGetAiKey).toHaveBeenCalledTimes(1);
      expect(mockGetAiKey).toHaveBeenCalledWith('user-001', 'openai');
      expect(mockAssessTopicFeasibility).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: 'Private podcast infrastructure',
          apiKeyOverride: 'provider-key',
          model: 'gpt-5-mini',
          provider: 'openai',
        }),
      );
      expect(mockLogUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'openai',
          category: 'topic_assessment',
          podcastId: 'podcast-001',
          userId: 'user-001',
        }),
      );
    });

    it('rejects explicit non-local models without a matching provider key', async () => {
      mockGetAiKey.mockResolvedValue(null);

      await expect(processContentExtraction(createMockJob({
        ...defaultPayload,
        sourceText: 'Source material',
      }))).rejects.toThrow(
        'AI key for provider "openai" is required for topic feasibility assessment.',
      );

      expect(mockGetAiKey).toHaveBeenCalledWith('user-001', 'openai');
      expect(mockAssessTopicFeasibility).not.toHaveBeenCalled();
    });

    it('uses platform credentials only for explicit admin-credit routes', async () => {
      await processContentExtraction(createMockJob({
        ...defaultPayload,
        sourceText: 'Source material',
        useAdminCredits: true,
      }));

      expect(mockGetAiKey).not.toHaveBeenCalled();
      expect(mockResolveAiModelAndProvider).toHaveBeenCalledWith({
        podcastAiModel: 'gpt-5-mini',
        aiKey: null,
      });
      expect(mockAssessTopicFeasibility).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyOverride: undefined,
          model: 'gpt-5-mini',
          provider: 'openai',
        }),
      );
    });

    it('uses the configured BYOK provider when the podcast has no model', async () => {
      const aiKey = { apiKey: 'anthropic-key', provider: 'anthropic' };
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        source: 'WEB',
        aiModel: null,
        user: {},
      });
      mockGetAiKey.mockResolvedValue(aiKey);
      mockResolveAiModelAndProvider.mockResolvedValue({
        model: 'claude-haiku-4-5-20251001',
        provider: 'anthropic',
      });

      await processContentExtraction(createMockJob({
        ...defaultPayload,
        sourceText: 'Source material',
      }));

      expect(mockGetAiKey).toHaveBeenCalledTimes(1);
      expect(mockGetAiKey).toHaveBeenCalledWith('user-001');
      expect(mockResolveAiModelAndProvider).toHaveBeenCalledWith({
        podcastAiModel: null,
        aiKey,
      });
      expect(mockAssessTopicFeasibility).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyOverride: 'anthropic-key',
          model: 'claude-haiku-4-5-20251001',
          provider: 'anthropic',
        }),
      );
    });

    it('rejects WEB feasibility checks without an explicit model or AI key', async () => {
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        source: 'WEB',
        aiModel: null,
        user: {},
      });
      mockGetAiKey.mockResolvedValue(null);

      await expect(processContentExtraction(createMockJob({
        ...defaultPayload,
        sourceText: 'Source material',
      }))).rejects.toThrow(
        'AI model is required for topic feasibility assessment when no AI key is configured.',
      );

      expect(mockResolveAiModelAndProvider).not.toHaveBeenCalled();
      expect(mockAssessTopicFeasibility).not.toHaveBeenCalled();
    });

    it('routes explicit Claude Code models without fetching a provider key', async () => {
      mockPrismaPodcastFindUniqueOrThrow.mockResolvedValue({
        source: 'WEB',
        aiModel: 'claude-code:opus',
        user: {},
      });
      mockResolveAiModelAndProvider.mockResolvedValue({
        model: 'claude-code:opus',
        provider: 'claude-code',
      });

      await processContentExtraction(createMockJob({
        ...defaultPayload,
        sourceText: 'Source material',
      }));

      expect(mockGetAiKey).not.toHaveBeenCalled();
      expect(mockAssessTopicFeasibility).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyOverride: undefined,
          model: 'claude-code:opus',
          provider: 'claude-code',
        }),
      );
    });
  });

  describe('database updates', () => {
    it('updates podcast status to RESEARCHING', async () => {
      const job = createMockJob({
        ...defaultPayload,
        sourceText: 'Test content',
      });
      await processContentExtraction(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: { status: 'RESEARCHING' },
      });
    });

    it('invalidates podcast cache and publishes status after RESEARCHING transition', async () => {
      const job = createMockJob({
        ...defaultPayload,
        sourceText: 'Test content',
      });
      await processContentExtraction(job);

      expect(mockInvalidatePodcastCache).toHaveBeenCalledWith('podcast-001');
      expect(mockPublishPodcastStatus).toHaveBeenCalledWith('podcast-001', { status: 'RESEARCHING' });
    });
  });

  describe('pipeline chaining', () => {
    it('queues deep research job after extraction', async () => {
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

      expect(mockAddJob).toHaveBeenCalledWith({ name: 'deep-research' }, 'deep_research', {
        podcastId: 'podcast-001',
        userId: 'user-001',
        discoveryId: 'discovery-abc',
        useAdminCredits: undefined,
      }, { jobId: expect.any(String) });
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
        data: { status: 'RESEARCHING' },
      });
      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'deep-research' },
        'deep_research',
        expect.objectContaining({
          podcastId: 'podcast-001',
          discoveryId: 'discovery-existing',
        }),
        { jobId: expect.any(String) },
      );
    });

    it('invalidates cache on the idempotent early-return path too', async () => {
      mockPrismaDiscoveryFindUnique.mockResolvedValue({
        id: 'discovery-existing',
        sourceContent: 'Already extracted content',
      });

      const job = createMockJob({
        ...defaultPayload,
        sourceUrl: 'https://example.com/article',
      });
      await processContentExtraction(job);

      expect(mockInvalidatePodcastCache).toHaveBeenCalledWith('podcast-001');
      expect(mockPublishPodcastStatus).toHaveBeenCalledWith('podcast-001', { status: 'RESEARCHING' });
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

  describe('empty content detection', () => {
    it('throws when URL extraction returns empty content and no sourceText', async () => {
      mockExtractContent.mockResolvedValue({
        text: '', markdown: '', title: null, description: null,
        siteName: null, author: null, publishedDate: null,
        wordCount: 0, sourceType: 'html', extractionMethod: 'readability',
      });

      const job = createMockJob({
        ...defaultPayload,
        sourceUrl: 'https://example.com/empty',
      });

      await expect(processContentExtraction(job)).rejects.toThrow(
        'Could not extract content from https://example.com/empty'
      );
    });

    it('throws YouTube-specific message when transcript is empty', async () => {
      mockExtractContent.mockResolvedValue({
        text: '', markdown: '', title: null,
        description: 'No transcript available for this video',
        siteName: 'YouTube', author: null, publishedDate: null,
        wordCount: 0, sourceType: 'youtube', extractionMethod: 'summarize-core',
      });

      const job = createMockJob({
        ...defaultPayload,
        sourceUrl: 'https://www.youtube.com/watch?v=no-transcript',
      });

      await expect(processContentExtraction(job)).rejects.toThrow(
        'No transcript available for this YouTube video'
      );
    });

    it('succeeds when sourceText is provided even if URL extraction is empty', async () => {
      mockExtractContent.mockResolvedValue({
        text: '', markdown: '', title: null, description: null,
        siteName: null, author: null, publishedDate: null,
        wordCount: 0, sourceType: 'html', extractionMethod: 'readability',
      });

      const job = createMockJob({
        ...defaultPayload,
        sourceUrl: 'https://example.com/empty',
        sourceText: 'User provided text content here',
      });

      await processContentExtraction(job);

      expect(mockPrismaDiscoveryUpdate).toHaveBeenCalled();
      expect(mockAddJob).toHaveBeenCalled();
    });

    it('succeeds when sourceText-only is provided without sourceUrl', async () => {
      const job = createMockJob({
        ...defaultPayload,
        sourceText: 'Just user text, no URL',
      });

      await processContentExtraction(job);

      expect(mockExtractContent).not.toHaveBeenCalled();
      expect(mockPrismaDiscoveryUpdate).toHaveBeenCalled();
    });
  });
});
