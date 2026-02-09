import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks (must be declared before any import that touches the modules) ----

const mockPrismaDiscoveryFindUniqueOrThrow = vi.fn().mockResolvedValue({
  id: 'discovery-001',
  topic: 'Quantum Computing',
  depth: 'standard',
  audienceLevel: 'intermediate',
  focusAreas: ['algorithms', 'applications'],
  tone: 'casual',
  durationTarget: 10,
  sourceContent: null,
});

const mockPrismaScriptCreate = vi.fn().mockResolvedValue({
  id: 'script-001',
  podcastId: 'podcast-001',
});

const mockPrismaReferenceCreateMany = vi.fn().mockResolvedValue({ count: 5 });

const mockPrismaSegmentCreate = vi.fn().mockImplementation((args) => ({
  id: `segment-${args.data.order}`,
  ...args.data,
}));

const mockPrismaPodcastUpdate = vi.fn().mockResolvedValue({});

vi.mock('@/lib/prisma', () => ({
  prisma: {
    discovery: {
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaDiscoveryFindUniqueOrThrow(...args),
    },
    script: {
      create: (...args: unknown[]) => mockPrismaScriptCreate(...args),
    },
    reference: {
      createMany: (...args: unknown[]) => mockPrismaReferenceCreateMany(...args),
    },
    segment: {
      create: (...args: unknown[]) => mockPrismaSegmentCreate(...args),
    },
    podcast: {
      update: (...args: unknown[]) => mockPrismaPodcastUpdate(...args),
    },
  },
}));

const mockGenerateScript = vi.fn().mockResolvedValue({
  turns: [
    { speaker: 'HOST', text: 'Welcome to the show!' },
    { speaker: 'EXPERT', text: 'Thanks for having me!' },
  ],
  soundCues: [
    { type: 'intro', prompt: 'warm podcast intro', durationSeconds: 3, insertAfterTurn: -1 },
    { type: 'outro', prompt: 'gentle outro', durationSeconds: 4, insertAfterTurn: 1 },
  ],
  references: [],
  markdown: '**HOST:** Welcome to the show!\n\n**EXPERT:** Thanks for having me!',
  inputTokens: 1000,
  outputTokens: 500,
});

vi.mock('@/lib/script-generator', () => ({
  generateScript: (...args: unknown[]) => mockGenerateScript(...args),
}));

const mockLogApiUsage = vi.fn().mockResolvedValue({});

vi.mock('@/lib/claude', () => ({
  logApiUsage: (...args: unknown[]) => mockLogApiUsage(...args),
}));

const mockAddJob = vi.fn().mockResolvedValue({ id: 'job-1' });

vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: {
    VALIDATE_REFERENCES: 'validate_references',
    GENERATE_AUDIO: 'generate_audio',
  },
  referenceValidationQueue: { name: 'reference-validation' },
  audioGenerationQueue: { name: 'audio-generation' },
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
import { processScriptGeneration } from '@/workers/script-generation.worker';
import type { GenerateScriptPayload } from '@/lib/queue';
import type { Job } from 'bullmq';

// ---- Helpers ----

function createMockJob(data: GenerateScriptPayload): Job<GenerateScriptPayload> {
  return {
    data,
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<GenerateScriptPayload>;
}

const defaultPayload: GenerateScriptPayload = {
  podcastId: 'podcast-001',
  userId: 'user-001',
  discoveryId: 'discovery-001',
};

// ---- Tests ----

describe('processScriptGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default discovery data
    mockPrismaDiscoveryFindUniqueOrThrow.mockResolvedValue({
      id: 'discovery-001',
      topic: 'Quantum Computing',
      depth: 'standard',
      audienceLevel: 'intermediate',
      focusAreas: ['algorithms', 'applications'],
      tone: 'casual',
      durationTarget: 10,
      sourceContent: null,
    });

    // Default script generation result (no references)
    mockGenerateScript.mockResolvedValue({
      turns: [
        { speaker: 'HOST', text: 'Welcome to the show!' },
        { speaker: 'EXPERT', text: 'Thanks for having me!' },
      ],
      soundCues: [
        { type: 'intro', prompt: 'warm podcast intro', durationSeconds: 3, insertAfterTurn: -1 },
        { type: 'outro', prompt: 'gentle outro', durationSeconds: 4, insertAfterTurn: 1 },
      ],
      references: [],
      markdown: '**HOST:** Welcome to the show!\n\n**EXPERT:** Thanks for having me!',
      inputTokens: 1000,
      outputTokens: 500,
    });

    // Reset all Prisma mocks
    mockPrismaScriptCreate.mockResolvedValue({
      id: 'script-001',
      podcastId: 'podcast-001',
    });
    mockPrismaPodcastUpdate.mockResolvedValue({});
    mockPrismaSegmentCreate.mockImplementation((args) => ({
      id: `segment-${args.data.order}`,
      ...args.data,
    }));
    mockAddJob.mockResolvedValue({ id: 'job-1' });
  });

  describe('discovery metadata fetch', () => {
    it('fetches discovery metadata from database', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockPrismaDiscoveryFindUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'discovery-001' },
      });
    });

    it('throws if discovery not found', async () => {
      mockPrismaDiscoveryFindUniqueOrThrow.mockRejectedValue(new Error('Discovery not found'));
      const job = createMockJob(defaultPayload);

      await expect(processScriptGeneration(job)).rejects.toThrow('Discovery not found');
    });
  });

  describe('Claude prompt construction', () => {
    it('passes all discovery parameters to generateScript', async () => {
      mockPrismaDiscoveryFindUniqueOrThrow.mockResolvedValue({
        topic: 'AI Safety',
        depth: 'deep_dive',
        audienceLevel: 'expert',
        focusAreas: ['alignment', 'interpretability'],
        tone: 'professional',
        durationTarget: 20,
        sourceContent: 'Research paper content here...',
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockGenerateScript).toHaveBeenCalledWith({
        topic: 'AI Safety',
        depth: 'deep_dive',
        audienceLevel: 'expert',
        focusAreas: ['alignment', 'interpretability'],
        tone: 'professional',
        durationTarget: 20,
        sourceContent: 'Research paper content here...',
      });
    });

    it('passes empty strings as fallback for null topic', async () => {
      mockPrismaDiscoveryFindUniqueOrThrow.mockResolvedValue({
        topic: null,
        depth: null,
        audienceLevel: null,
        focusAreas: [],
        tone: null,
        durationTarget: null,
        sourceContent: null,
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockGenerateScript).toHaveBeenCalledWith({
        topic: '',
        depth: 'standard',
        audienceLevel: 'intermediate',
        focusAreas: [],
        tone: 'casual',
        durationTarget: 10,
        sourceContent: undefined,
      });
    });

    it('omits sourceContent parameter when null', async () => {
      mockPrismaDiscoveryFindUniqueOrThrow.mockResolvedValue({
        topic: 'Machine Learning',
        depth: 'quick_overview',
        audienceLevel: 'beginner',
        focusAreas: ['basics'],
        tone: 'casual',
        durationTarget: 5,
        sourceContent: null,
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockGenerateScript).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceContent: undefined,
        })
      );
    });

    it('includes sourceContent when present', async () => {
      mockPrismaDiscoveryFindUniqueOrThrow.mockResolvedValue({
        topic: 'Blockchain',
        depth: 'standard',
        audienceLevel: 'intermediate',
        focusAreas: ['consensus'],
        tone: 'casual',
        durationTarget: 10,
        sourceContent: 'Source content about blockchain...',
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockGenerateScript).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceContent: 'Source content about blockchain...',
        })
      );
    });
  });

  describe('script persistence', () => {
    it('saves script with turns, soundCues, and markdown', async () => {
      mockGenerateScript.mockResolvedValue({
        turns: [
          { speaker: 'HOST', text: 'First turn', direction: 'excited' },
          { speaker: 'EXPERT', text: 'Second turn' },
        ],
        soundCues: [
          { type: 'intro', prompt: 'intro music', durationSeconds: 3, insertAfterTurn: -1 },
        ],
        references: [],
        markdown: '**HOST:** First turn\n\n**EXPERT:** Second turn',
        inputTokens: 1500,
        outputTokens: 800,
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockPrismaScriptCreate).toHaveBeenCalledWith({
        data: {
          podcastId: 'podcast-001',
          turns: [
            { speaker: 'HOST', text: 'First turn', direction: 'excited' },
            { speaker: 'EXPERT', text: 'Second turn' },
          ],
          soundCues: [
            { type: 'intro', prompt: 'intro music', durationSeconds: 3, insertAfterTurn: -1 },
          ],
          markdown: '**HOST:** First turn\n\n**EXPERT:** Second turn',
        },
      });
    });

    it('omits soundCues when empty array', async () => {
      mockGenerateScript.mockResolvedValue({
        turns: [{ speaker: 'HOST', text: 'Hello' }],
        soundCues: [],
        references: [],
        markdown: '**HOST:** Hello',
        inputTokens: 500,
        outputTokens: 200,
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockPrismaScriptCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          soundCues: undefined,
        }),
      });
    });

    it('includes soundCues when non-empty', async () => {
      mockGenerateScript.mockResolvedValue({
        turns: [{ speaker: 'HOST', text: 'Hello' }],
        soundCues: [
          { type: 'intro', prompt: 'intro', durationSeconds: 3, insertAfterTurn: -1 },
          { type: 'outro', prompt: 'outro', durationSeconds: 4, insertAfterTurn: 0 },
        ],
        references: [],
        markdown: '**HOST:** Hello',
        inputTokens: 500,
        outputTokens: 200,
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockPrismaScriptCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          soundCues: [
            { type: 'intro', prompt: 'intro', durationSeconds: 3, insertAfterTurn: -1 },
            { type: 'outro', prompt: 'outro', durationSeconds: 4, insertAfterTurn: 0 },
          ],
        }),
      });
    });
  });

  describe('reference extraction and persistence', () => {
    it('saves references when present in script result', async () => {
      mockGenerateScript.mockResolvedValue({
        turns: [
          { speaker: 'HOST', text: 'According to research [1]...' },
          { speaker: 'EXPERT', text: 'The study found [2]...' },
        ],
        soundCues: [],
        references: [
          {
            number: 1,
            title: 'Quantum Supremacy Using a Programmable Superconducting Processor',
            authors: ['John Martinis', 'Sergio Boixo'],
            year: 2019,
            url: 'https://www.nature.com/articles/s41586-019-1666-5',
            type: 'PAPER',
            publisher: 'Nature',
            doi: '10.1038/s41586-019-1666-5',
          },
          {
            number: 2,
            title: 'Introduction to Quantum Computing',
            authors: ['Michael Nielsen', 'Isaac Chuang'],
            year: 2010,
            url: null,
            type: 'BOOK',
            publisher: 'Cambridge University Press',
            doi: null,
          },
        ],
        markdown: '**HOST:** According to research [1]...',
        inputTokens: 2000,
        outputTokens: 1200,
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockPrismaReferenceCreateMany).toHaveBeenCalledWith({
        data: [
          {
            podcastId: 'podcast-001',
            number: 1,
            title: 'Quantum Supremacy Using a Programmable Superconducting Processor',
            authors: ['John Martinis', 'Sergio Boixo'],
            year: 2019,
            url: 'https://www.nature.com/articles/s41586-019-1666-5',
            type: 'PAPER',
            publisher: 'Nature',
            doi: '10.1038/s41586-019-1666-5',
          },
          {
            podcastId: 'podcast-001',
            number: 2,
            title: 'Introduction to Quantum Computing',
            authors: ['Michael Nielsen', 'Isaac Chuang'],
            year: 2010,
            url: null,
            type: 'BOOK',
            publisher: 'Cambridge University Press',
            doi: null,
          },
        ],
      });
    });

    it('does not call createMany when no references', async () => {
      mockGenerateScript.mockResolvedValue({
        turns: [{ speaker: 'HOST', text: 'No citations here' }],
        soundCues: [],
        references: [],
        markdown: '**HOST:** No citations here',
        inputTokens: 800,
        outputTokens: 400,
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockPrismaReferenceCreateMany).not.toHaveBeenCalled();
    });

    it('handles references with null fields', async () => {
      mockGenerateScript.mockResolvedValue({
        turns: [{ speaker: 'HOST', text: 'Citing [1]' }],
        soundCues: [],
        references: [
          {
            number: 1,
            title: 'Web Article',
            authors: [],
            year: null,
            url: 'https://example.com/article',
            type: 'WEB',
            publisher: null,
            doi: null,
          },
        ],
        markdown: '**HOST:** Citing [1]',
        inputTokens: 900,
        outputTokens: 450,
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockPrismaReferenceCreateMany).toHaveBeenCalledWith({
        data: [
          {
            podcastId: 'podcast-001',
            number: 1,
            title: 'Web Article',
            authors: [],
            year: null,
            url: 'https://example.com/article',
            type: 'WEB',
            publisher: null,
            doi: null,
          },
        ],
      });
    });
  });

  describe('pipeline routing: with references', () => {
    beforeEach(() => {
      mockGenerateScript.mockResolvedValue({
        turns: [{ speaker: 'HOST', text: 'With refs [1]' }],
        soundCues: [],
        references: [
          {
            number: 1,
            title: 'Test Paper',
            authors: ['Author'],
            year: 2023,
            url: 'https://example.com',
            type: 'PAPER',
            publisher: null,
            doi: null,
          },
        ],
        markdown: '**HOST:** With refs [1]',
        inputTokens: 1000,
        outputTokens: 500,
      });
    });

    it('updates podcast status to VALIDATING_REFERENCES when references exist', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: { status: 'VALIDATING_REFERENCES' },
      });
    });

    it('queues reference validation job when references exist', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'reference-validation' },
        'validate_references',
        {
          podcastId: 'podcast-001',
          userId: 'user-001',
        }
      );
    });

    it('does not create segments when references exist', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockPrismaSegmentCreate).not.toHaveBeenCalled();
    });

    it('does not queue audio generation when references exist', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      const audioGenerationCalls = mockAddJob.mock.calls.filter(
        (call) => call[1] === 'generate_audio'
      );
      expect(audioGenerationCalls).toHaveLength(0);
    });
  });

  describe('pipeline routing: without references', () => {
    beforeEach(() => {
      mockGenerateScript.mockResolvedValue({
        turns: [
          { speaker: 'HOST', text: 'First turn' },
          { speaker: 'EXPERT', text: 'Second turn' },
          { speaker: 'HOST', text: 'Third turn' },
        ],
        soundCues: [],
        references: [],
        markdown: '**HOST:** First turn\n\n**EXPERT:** Second turn\n\n**HOST:** Third turn',
        inputTokens: 1500,
        outputTokens: 800,
      });
    });

    it('creates segments with correct order when no references', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockPrismaSegmentCreate).toHaveBeenCalledTimes(3);
      expect(mockPrismaSegmentCreate).toHaveBeenNthCalledWith(1, {
        data: {
          podcastId: 'podcast-001',
          speaker: 'HOST',
          text: 'First turn',
          order: 0,
        },
      });
      expect(mockPrismaSegmentCreate).toHaveBeenNthCalledWith(2, {
        data: {
          podcastId: 'podcast-001',
          speaker: 'EXPERT',
          text: 'Second turn',
          order: 1,
        },
      });
      expect(mockPrismaSegmentCreate).toHaveBeenNthCalledWith(3, {
        data: {
          podcastId: 'podcast-001',
          speaker: 'HOST',
          text: 'Third turn',
          order: 2,
        },
      });
    });

    it('queues audio generation for each segment', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockAddJob).toHaveBeenCalledTimes(3);
      expect(mockAddJob).toHaveBeenNthCalledWith(
        1,
        { name: 'audio-generation' },
        'generate_audio',
        {
          podcastId: 'podcast-001',
          segmentId: 'segment-0',
          speaker: 'HOST',
          text: 'First turn',
        }
      );
      expect(mockAddJob).toHaveBeenNthCalledWith(
        2,
        { name: 'audio-generation' },
        'generate_audio',
        {
          podcastId: 'podcast-001',
          segmentId: 'segment-1',
          speaker: 'EXPERT',
          text: 'Second turn',
        }
      );
      expect(mockAddJob).toHaveBeenNthCalledWith(
        3,
        { name: 'audio-generation' },
        'generate_audio',
        {
          podcastId: 'podcast-001',
          segmentId: 'segment-2',
          speaker: 'HOST',
          text: 'Third turn',
        }
      );
    });

    it('updates podcast status to GENERATING_AUDIO when no references', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: { status: 'GENERATING_AUDIO' },
      });
    });

    it('does not queue reference validation when no references', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      const validationCalls = mockAddJob.mock.calls.filter(
        (call) => call[1] === 'validate_references'
      );
      expect(validationCalls).toHaveLength(0);
    });
  });

  describe('API usage logging', () => {
    it('logs Claude API usage with token counts', async () => {
      mockGenerateScript.mockResolvedValue({
        turns: [{ speaker: 'HOST', text: 'Hello' }],
        soundCues: [],
        references: [],
        markdown: '**HOST:** Hello',
        inputTokens: 2500,
        outputTokens: 1800,
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockLogApiUsage).toHaveBeenCalledWith({
        podcastId: 'podcast-001',
        userId: 'user-001',
        category: 'script_generation',
        inputTokens: 2500,
        outputTokens: 1800,
      });
    });

    it('logs usage even when no references', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockLogApiUsage).toHaveBeenCalled();
    });

    it('logs usage even when references exist', async () => {
      mockGenerateScript.mockResolvedValue({
        turns: [{ speaker: 'HOST', text: 'With refs [1]' }],
        soundCues: [],
        references: [
          {
            number: 1,
            title: 'Test',
            authors: [],
            year: 2023,
            url: null,
            type: 'WEB',
            publisher: null,
            doi: null,
          },
        ],
        markdown: '**HOST:** With refs [1]',
        inputTokens: 3000,
        outputTokens: 2000,
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(mockLogApiUsage).toHaveBeenCalled();
    });
  });

  describe('job progress tracking', () => {
    it('reports progress at 10% after starting', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(job.updateProgress).toHaveBeenCalledWith(10);
    });

    it('reports progress at 50% after script generation', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(job.updateProgress).toHaveBeenCalledWith(50);
    });

    it('reports progress at 100% at completion', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      expect(job.updateProgress).toHaveBeenCalledWith(100);
    });

    it('reports progress in correct order', async () => {
      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      const progressCalls = (job.updateProgress as ReturnType<typeof vi.fn>).mock.calls.map(
        (call: number[]) => call[0]
      );
      expect(progressCalls).toEqual([10, 50, 100]);
    });
  });

  describe('error propagation', () => {
    it('propagates errors from generateScript', async () => {
      mockGenerateScript.mockRejectedValue(new Error('Claude API rate limited'));
      const job = createMockJob(defaultPayload);

      await expect(processScriptGeneration(job)).rejects.toThrow('Claude API rate limited');
    });

    it('propagates errors from script.create', async () => {
      mockPrismaScriptCreate.mockRejectedValue(new Error('Database constraint violation'));
      const job = createMockJob(defaultPayload);

      await expect(processScriptGeneration(job)).rejects.toThrow('Database constraint violation');
    });

    it('propagates errors from reference.createMany', async () => {
      mockPrismaScriptCreate.mockResolvedValueOnce({
        id: 'script-001',
        podcastId: 'podcast-001',
      });
      mockGenerateScript.mockResolvedValue({
        turns: [{ speaker: 'HOST', text: 'Test' }],
        soundCues: [],
        references: [
          {
            number: 1,
            title: 'Test',
            authors: [],
            year: 2023,
            url: null,
            type: 'PAPER',
            publisher: null,
            doi: null,
          },
        ],
        markdown: '**HOST:** Test',
        inputTokens: 1000,
        outputTokens: 500,
      });
      mockPrismaReferenceCreateMany.mockRejectedValue(new Error('Foreign key constraint failed'));
      const job = createMockJob(defaultPayload);

      await expect(processScriptGeneration(job)).rejects.toThrow('Foreign key constraint failed');
    });

    it('propagates errors from segment.create', async () => {
      mockPrismaScriptCreate.mockResolvedValueOnce({
        id: 'script-001',
        podcastId: 'podcast-001',
      });
      mockPrismaSegmentCreate.mockRejectedValue(new Error('Segment creation failed'));
      const job = createMockJob(defaultPayload);

      await expect(processScriptGeneration(job)).rejects.toThrow('Segment creation failed');
    });

    it('propagates errors from addJob', async () => {
      mockPrismaScriptCreate.mockResolvedValueOnce({
        id: 'script-001',
        podcastId: 'podcast-001',
      });
      mockPrismaReferenceCreateMany.mockResolvedValueOnce({ count: 1 });
      mockPrismaPodcastUpdate.mockResolvedValueOnce({});
      mockAddJob.mockRejectedValue(new Error('Queue connection failed'));
      mockGenerateScript.mockResolvedValue({
        turns: [{ speaker: 'HOST', text: 'Test' }],
        soundCues: [],
        references: [
          {
            number: 1,
            title: 'Test',
            authors: [],
            year: 2023,
            url: null,
            type: 'PAPER',
            publisher: null,
            doi: null,
          },
        ],
        markdown: '**HOST:** Test',
        inputTokens: 1000,
        outputTokens: 500,
      });
      const job = createMockJob(defaultPayload);

      await expect(processScriptGeneration(job)).rejects.toThrow('Queue connection failed');
    });
  });

  describe('end-to-end flows', () => {
    it('executes full pipeline with references', async () => {
      mockPrismaReferenceCreateMany.mockResolvedValue({ count: 2 });
      mockGenerateScript.mockResolvedValue({
        turns: [
          { speaker: 'HOST', text: 'Let me cite this [1]' },
          { speaker: 'EXPERT', text: 'And also this [2]' },
        ],
        soundCues: [{ type: 'intro', prompt: 'intro', durationSeconds: 3, insertAfterTurn: -1 }],
        references: [
          {
            number: 1,
            title: 'Paper One',
            authors: ['Smith'],
            year: 2022,
            url: 'https://example.com/1',
            type: 'PAPER',
            publisher: 'Nature',
            doi: '10.1234/abc',
          },
          {
            number: 2,
            title: 'Paper Two',
            authors: ['Jones'],
            year: 2023,
            url: 'https://example.com/2',
            type: 'ARTICLE',
            publisher: 'Science',
            doi: '10.5678/def',
          },
        ],
        markdown: '**HOST:** Let me cite this [1]\n\n**EXPERT:** And also this [2]',
        inputTokens: 1800,
        outputTokens: 1200,
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      // Discovery fetched
      expect(mockPrismaDiscoveryFindUniqueOrThrow).toHaveBeenCalled();

      // Script generated
      expect(mockGenerateScript).toHaveBeenCalled();

      // Script saved
      expect(mockPrismaScriptCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          podcastId: 'podcast-001',
          turns: expect.arrayContaining([
            expect.objectContaining({ speaker: 'HOST', text: 'Let me cite this [1]' }),
          ]),
        }),
      });

      // References saved
      expect(mockPrismaReferenceCreateMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ number: 1, title: 'Paper One' }),
          expect.objectContaining({ number: 2, title: 'Paper Two' }),
        ]),
      });

      // Status updated to VALIDATING_REFERENCES
      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: { status: 'VALIDATING_REFERENCES' },
      });

      // Validation job queued
      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'reference-validation' },
        'validate_references',
        expect.objectContaining({ podcastId: 'podcast-001' })
      );

      // No segments created
      expect(mockPrismaSegmentCreate).not.toHaveBeenCalled();

      // Usage logged
      expect(mockLogApiUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'script_generation',
          inputTokens: 1800,
          outputTokens: 1200,
        })
      );

      // Progress tracked
      expect(job.updateProgress).toHaveBeenCalledWith(100);
    });

    it('executes full pipeline without references', async () => {
      mockGenerateScript.mockResolvedValue({
        turns: [
          { speaker: 'HOST', text: 'No citations here' },
          { speaker: 'EXPERT', text: 'Just conversation' },
        ],
        soundCues: [],
        references: [],
        markdown: '**HOST:** No citations here\n\n**EXPERT:** Just conversation',
        inputTokens: 1200,
        outputTokens: 600,
      });

      const job = createMockJob(defaultPayload);
      await processScriptGeneration(job);

      // Discovery fetched
      expect(mockPrismaDiscoveryFindUniqueOrThrow).toHaveBeenCalled();

      // Script generated
      expect(mockGenerateScript).toHaveBeenCalled();

      // Script saved
      expect(mockPrismaScriptCreate).toHaveBeenCalled();

      // No references saved
      expect(mockPrismaReferenceCreateMany).not.toHaveBeenCalled();

      // Segments created
      expect(mockPrismaSegmentCreate).toHaveBeenCalledTimes(2);

      // Audio jobs queued
      const audioJobs = mockAddJob.mock.calls.filter((call) => call[1] === 'generate_audio');
      expect(audioJobs).toHaveLength(2);

      // Status updated to GENERATING_AUDIO
      expect(mockPrismaPodcastUpdate).toHaveBeenCalledWith({
        where: { id: 'podcast-001' },
        data: { status: 'GENERATING_AUDIO' },
      });

      // No validation job
      const validationJobs = mockAddJob.mock.calls.filter(
        (call) => call[1] === 'validate_references'
      );
      expect(validationJobs).toHaveLength(0);

      // Usage logged
      expect(mockLogApiUsage).toHaveBeenCalled();

      // Progress tracked
      expect(job.updateProgress).toHaveBeenCalledWith(100);
    });
  });
});
