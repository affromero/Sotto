import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks (must be declared before any import that touches the modules) ----

const mockPrismaScriptFindUnique = vi.fn().mockResolvedValue({
  turns: [
    { speaker: 'HOST', text: 'Welcome to the show!' },
    { speaker: 'EXPERT', text: 'Thanks for having me.' },
  ],
});
const mockPrismaPodcastFindUnique = vi.fn().mockResolvedValue({ language: null });
const mockPrismaUserFindUnique = vi.fn().mockResolvedValue({ preferredLanguage: null });
const mockPrismaSegmentFindMany = vi.fn().mockResolvedValue([]);
const mockPrismaInteractionUpdate = vi.fn().mockResolvedValue({});
const mockPrismaApiUsageLogCreate = vi.fn().mockResolvedValue({});

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    script: {
      findUnique: (...args: unknown[]) => mockPrismaScriptFindUnique(...args),
    },
    podcast: {
      findUnique: (...args: unknown[]) => mockPrismaPodcastFindUnique(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => mockPrismaUserFindUnique(...args),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ plan: 'FREE' }),
    },
    segment: {
      findMany: (...args: unknown[]) => mockPrismaSegmentFindMany(...args),
    },
    interaction: {
      update: (...args: unknown[]) => mockPrismaInteractionUpdate(...args),
    },
    apiUsageLog: {
      create: (...args: unknown[]) => mockPrismaApiUsageLogCreate(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

const mockGenerateResponse = vi.fn().mockResolvedValue({
  content: 'Here is the answer to your question.',
  inputTokens: 150,
  outputTokens: 50,
});

const mockLogUsage = vi.fn();

vi.mock('@/lib/claude', () => ({
  generateResponse: (...args: unknown[]) => mockGenerateResponse(...args),
}));

vi.mock('@/lib/usage-logger', () => ({
  logUsage: (...args: unknown[]) => mockLogUsage(...args),
}));

vi.mock('@/lib/byok', () => ({
  getAiKey: vi.fn().mockResolvedValue(null),
  hasByokKey: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/lib/tier-features', () => ({
  getTierFeatures: vi.fn().mockReturnValue({
    maxDurationMinutes: 40,
    maxQaInteractions: Infinity,
    webSearchEnabled: true,
    autoApproveScript: false,
    privateAllowed: true,
    analyticsEnabled: true,
  }),
}));

vi.mock('@/lib/free-tier-config', () => ({
  getFreeTierConfig: vi.fn().mockResolvedValue({ aiModel: 'claude-haiku-4-5-20251001', aiAllocations: [] }),
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
import { processInteraction } from '@/workers/interaction.worker';
import type { ProcessInteractionPayload } from '@/lib/queue';
import type { Job } from 'bullmq';

// ---- Helpers ----

function createMockJob(data: ProcessInteractionPayload): Job<ProcessInteractionPayload> {
  return {
    data,
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<ProcessInteractionPayload>;
}

const defaultPayload: ProcessInteractionPayload = {
  podcastId: 'podcast-001',
  interactionId: 'interaction-001',
  userId: 'user-001',
  question: 'Can you explain that in more detail?',
  timestamp: 45,
};

// ---- Tests ----

describe('processInteraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrismaPodcastFindUnique.mockResolvedValue({ language: null });
    mockPrismaUserFindUnique.mockResolvedValue({ preferredLanguage: null });
    mockPrismaScriptFindUnique.mockResolvedValue({
      turns: [
        { speaker: 'HOST', text: 'Welcome to the show!' },
        { speaker: 'EXPERT', text: 'Thanks for having me.' },
        { speaker: 'HOST', text: 'Today we discuss quantum computing.' },
        { speaker: 'EXPERT', text: 'Quantum computing leverages superposition and entanglement.' },
        { speaker: 'HOST', text: 'How does superposition work?' },
        { speaker: 'EXPERT', text: 'A qubit can exist in multiple states simultaneously.' },
        { speaker: 'HOST', text: 'That sounds complex.' },
        { speaker: 'EXPERT', text: 'It is, but it opens new computational possibilities.' },
      ],
    });
    mockPrismaSegmentFindMany.mockResolvedValue([
      { order: 0, startTime: 0, duration: 15 },
      { order: 1, startTime: 15, duration: 12 },
      { order: 2, startTime: 27, duration: 18 },
      { order: 3, startTime: 45, duration: 14 },
      { order: 4, startTime: 59, duration: 16 },
      { order: 5, startTime: 75, duration: 13 },
      { order: 6, startTime: 88, duration: 15 },
      { order: 7, startTime: 103, duration: 12 },
    ]);
    mockGenerateResponse.mockResolvedValue({
      content: 'Here is the answer to your question.',
      inputTokens: 150,
      outputTokens: 50,
    });
    mockPrismaInteractionUpdate.mockResolvedValue({});
    mockLogUsage.mockReset();
  });

  describe('script context lookup', () => {
    it('throws error when script is not found', async () => {
      mockPrismaScriptFindUnique.mockResolvedValue(null);
      const job = createMockJob(defaultPayload);

      await expect(processInteraction(job)).rejects.toThrow(
        'Script not found for podcast podcast-001'
      );
    });

    it('handles podcast with no turns gracefully', async () => {
      mockPrismaScriptFindUnique.mockResolvedValue({ turns: [] });
      const job = createMockJob(defaultPayload);
      await processInteraction(job);

      expect(mockGenerateResponse).toHaveBeenCalled();
    });
  });

  describe('segment-based timestamp lookup', () => {
    it('uses segment startTime + duration to find correct turn index', async () => {
      const job = createMockJob({ ...defaultPayload, timestamp: 50 });
      await processInteraction(job);

      const callArgs = mockGenerateResponse.mock.calls[0];
      const messages = callArgs[1];
      const content = messages[0].content;

      expect(content).toContain('Welcome to the show!');
      expect(content).toContain('Thanks for having me.');
      expect(content).toContain('Today we discuss quantum computing.');
      expect(content).toContain('Quantum computing leverages superposition and entanglement.');
    });

    it('falls back to text estimation when segments have no startTime', async () => {
      mockPrismaSegmentFindMany.mockResolvedValue([
        { order: 0, startTime: null, duration: null },
        { order: 1, startTime: null, duration: null },
        { order: 2, startTime: null, duration: null },
        { order: 3, startTime: null, duration: null },
      ]);
      const job = createMockJob({ ...defaultPayload, timestamp: 10 });
      await processInteraction(job);

      expect(mockGenerateResponse).toHaveBeenCalled();
      const callArgs = mockGenerateResponse.mock.calls[0];
      const messages = callArgs[1];
      expect(messages[0].content).toContain('Recent podcast context:');
    });

    it('handles timestamp at segment boundary', async () => {
      const job = createMockJob({ ...defaultPayload, timestamp: 27 });
      await processInteraction(job);

      const callArgs = mockGenerateResponse.mock.calls[0];
      const messages = callArgs[1];
      const content = messages[0].content;

      expect(content).toContain('Welcome to the show!');
      expect(content).toContain('Thanks for having me.');
      expect(content).toContain('Today we discuss quantum computing.');
    });
  });

  describe('context construction from timestamp', () => {
    it('builds context from turns based on timestamp position', async () => {
      const job = createMockJob({ ...defaultPayload, timestamp: 45 });
      await processInteraction(job);

      const callArgs = mockGenerateResponse.mock.calls[0];
      const messages = callArgs[1];
      expect(messages[0].content).toContain('Recent podcast context:');
    });

    it('takes last 5 turns as recent context', async () => {
      mockPrismaScriptFindUnique.mockResolvedValue({
        turns: [
          { speaker: 'HOST', text: 'Turn 1' },
          { speaker: 'EXPERT', text: 'Turn 2' },
          { speaker: 'HOST', text: 'Turn 3' },
          { speaker: 'EXPERT', text: 'Turn 4' },
          { speaker: 'HOST', text: 'Turn 5' },
          { speaker: 'EXPERT', text: 'Turn 6' },
          { speaker: 'HOST', text: 'Turn 7' },
          { speaker: 'EXPERT', text: 'Turn 8' },
        ],
      });
      // Timestamp 100 is within segment 6 (startTime 88, duration 15, ends at 103)
      // So turnIndex = 7 (first 7 turns: 0-6), last 5 = turns 2-6
      const job = createMockJob({ ...defaultPayload, timestamp: 100 });
      await processInteraction(job);

      const callArgs = mockGenerateResponse.mock.calls[0];
      const messages = callArgs[1];
      const content = messages[0].content;

      expect(content).toContain('Turn 3');
      expect(content).toContain('Turn 4');
      expect(content).toContain('Turn 5');
      expect(content).toContain('Turn 6');
      expect(content).toContain('Turn 7');
      expect(content).not.toContain('Turn 1');
      expect(content).not.toContain('Turn 2');
    });

    it('includes speaker labels in context turns', async () => {
      const job = createMockJob(defaultPayload);
      await processInteraction(job);

      const callArgs = mockGenerateResponse.mock.calls[0];
      const messages = callArgs[1];
      const content = messages[0].content;

      expect(content).toMatch(/HOST:/);
      expect(content).toMatch(/EXPERT:/);
    });

    it('handles early timestamp (beginning of podcast)', async () => {
      const job = createMockJob({ ...defaultPayload, timestamp: 5 });
      await processInteraction(job);

      const callArgs = mockGenerateResponse.mock.calls[0];
      const messages = callArgs[1];
      expect(messages[0].content).toContain('Recent podcast context:');
    });

    it('handles very late timestamp (end of podcast)', async () => {
      const job = createMockJob({ ...defaultPayload, timestamp: 1200 });
      await processInteraction(job);

      const callArgs = mockGenerateResponse.mock.calls[0];
      const messages = callArgs[1];
      expect(messages[0].content).toContain('Recent podcast context:');
    });

    it('constructs context message with user question', async () => {
      const job = createMockJob({
        ...defaultPayload,
        question: 'What is quantum entanglement?',
      });
      await processInteraction(job);

      const callArgs = mockGenerateResponse.mock.calls[0];
      const messages = callArgs[1];
      expect(messages[0].content).toContain("User's question: What is quantum entanglement?");
    });
  });

  describe('Claude answer generation', () => {
    it('calls generateResponse with correct system prompt', async () => {
      const job = createMockJob(defaultPayload);
      await processInteraction(job);

      const callArgs = mockGenerateResponse.mock.calls[0];
      const systemPrompt = callArgs[0];
      expect(systemPrompt).toContain("Sotto's Q&A assistant");
      expect(systemPrompt).toContain('podcast context');
      expect(systemPrompt).toContain('under 200 words');
    });

    it('calls generateResponse with user message containing context and question', async () => {
      const job = createMockJob(defaultPayload);
      await processInteraction(job);

      const callArgs = mockGenerateResponse.mock.calls[0];
      const messages = callArgs[1];
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toContain('Recent podcast context:');
      expect(messages[0].content).toContain("User's question:");
    });

    it('passes exact question text to Claude', async () => {
      const job = createMockJob({
        ...defaultPayload,
        question: 'Can you clarify the difference between classical and quantum bits?',
      });
      await processInteraction(job);

      const callArgs = mockGenerateResponse.mock.calls[0];
      const messages = callArgs[1];
      expect(messages[0].content).toContain(
        'Can you clarify the difference between classical and quantum bits?'
      );
    });
  });

  describe('interaction update with answer', () => {
    it('updates interaction with Claude answer and ANSWERED status', async () => {
      mockGenerateResponse.mockResolvedValue({
        content: 'Quantum entanglement is a phenomenon where particles become correlated.',
        inputTokens: 200,
        outputTokens: 75,
      });
      const job = createMockJob(defaultPayload);
      await processInteraction(job);

      expect(mockPrismaInteractionUpdate).toHaveBeenCalledWith({
        where: { id: 'interaction-001' },
        data: {
          answer: 'Quantum entanglement is a phenomenon where particles become correlated.',
          status: 'ANSWERED',
          segmentOrder: 3,
        },
      });
    });

    it('updates with multi-paragraph answer', async () => {
      mockGenerateResponse.mockResolvedValue({
        content: 'First paragraph.\n\nSecond paragraph with more detail.',
        inputTokens: 180,
        outputTokens: 60,
      });
      const job = createMockJob(defaultPayload);
      await processInteraction(job);

      expect(mockPrismaInteractionUpdate).toHaveBeenCalledWith({
        where: { id: 'interaction-001' },
        data: {
          answer: 'First paragraph.\n\nSecond paragraph with more detail.',
          status: 'ANSWERED',
          segmentOrder: 3,
        },
      });
    });

  });

  describe('API usage logging', () => {
    it('logs API usage with token counts', async () => {
      mockGenerateResponse.mockResolvedValue({
        content: 'Answer here.',
        inputTokens: 225,
        outputTokens: 90,
      });
      const job = createMockJob(defaultPayload);
      await processInteraction(job);

      expect(mockLogUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'anthropic',
          category: 'interaction',
          inputTokens: 225,
          outputTokens: 90,
          podcastId: 'podcast-001',
          userId: 'user-001',
        })
      );
    });

    it('logs correct userId from payload', async () => {
      const job = createMockJob({
        ...defaultPayload,
        userId: 'user-abc-123',
      });
      await processInteraction(job);

      expect(mockLogUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-abc-123',
        })
      );
    });

    it('logs correct podcastId from payload', async () => {
      const job = createMockJob({
        ...defaultPayload,
        podcastId: 'podcast-xyz-456',
      });
      await processInteraction(job);

      expect(mockLogUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          podcastId: 'podcast-xyz-456',
        })
      );
    });
  });

  describe('job progress tracking', () => {
    it('reports monotonically increasing progress ending at 100', async () => {
      const job = createMockJob(defaultPayload);
      await processInteraction(job);

      const calls = (job.updateProgress as ReturnType<typeof vi.fn>).mock.calls.map((c: any[]) => c[0]);
      for (let i = 1; i < calls.length; i++) {
        expect(calls[i]).toBeGreaterThanOrEqual(calls[i - 1]);
      }
      expect(calls[calls.length - 1]).toBe(100);
    });
  });

  describe('error propagation', () => {
    it('propagates error when script not found', async () => {
      mockPrismaScriptFindUnique.mockResolvedValue(null);
      const job = createMockJob(defaultPayload);

      await expect(processInteraction(job)).rejects.toThrow(
        'Script not found for podcast podcast-001'
      );
    });

    it('propagates error from Claude generateResponse', async () => {
      mockGenerateResponse.mockRejectedValue(new Error('Claude API rate limit exceeded'));
      const job = createMockJob(defaultPayload);

      await expect(processInteraction(job)).rejects.toThrow('Claude API rate limit exceeded');
    });

    it('propagates error from interaction update', async () => {
      mockPrismaInteractionUpdate.mockRejectedValue(new Error('Interaction not found'));
      const job = createMockJob(defaultPayload);

      await expect(processInteraction(job)).rejects.toThrow('Interaction not found');
    });

    // logUsage is fire-and-forget — errors are silently caught
  });

  describe('edge cases', () => {
    it('handles single-turn script', async () => {
      mockPrismaScriptFindUnique.mockResolvedValue({
        turns: [{ speaker: 'HOST', text: 'This is a very short podcast.' }],
      });
      const job = createMockJob(defaultPayload);
      await processInteraction(job);

      expect(mockGenerateResponse).toHaveBeenCalled();
      expect(mockPrismaInteractionUpdate).toHaveBeenCalled();
    });

    it('handles timestamp of 0 (very start)', async () => {
      const job = createMockJob({ ...defaultPayload, timestamp: 0 });
      await processInteraction(job);

      expect(mockGenerateResponse).toHaveBeenCalled();
      const callArgs = mockGenerateResponse.mock.calls[0];
      const messages = callArgs[1];
      expect(messages[0].content).toContain('Recent podcast context:');
    });

    it('handles very long question text', async () => {
      const longQuestion = 'Can you explain '.repeat(50) + 'quantum computing?';
      const job = createMockJob({ ...defaultPayload, question: longQuestion });
      await processInteraction(job);

      expect(mockGenerateResponse).toHaveBeenCalled();
      const callArgs = mockGenerateResponse.mock.calls[0];
      const messages = callArgs[1];
      expect(messages[0].content).toContain(longQuestion);
    });

    it('handles Claude returning empty answer', async () => {
      mockGenerateResponse.mockResolvedValue({
        content: '',
        inputTokens: 100,
        outputTokens: 0,
      });
      const job = createMockJob(defaultPayload);
      await processInteraction(job);

      expect(mockPrismaInteractionUpdate).toHaveBeenCalledWith({
        where: { id: 'interaction-001' },
        data: {
          answer: '',
          status: 'ANSWERED',
          segmentOrder: 3,
        },
      });
    });

    it('handles script with very long turns', async () => {
      mockPrismaScriptFindUnique.mockResolvedValue({
        turns: [
          { speaker: 'HOST', text: 'A'.repeat(5000) },
          { speaker: 'EXPERT', text: 'B'.repeat(5000) },
        ],
      });
      const job = createMockJob(defaultPayload);
      await processInteraction(job);

      expect(mockGenerateResponse).toHaveBeenCalled();
    });
  });

  describe('end-to-end flow', () => {
    it('executes full interaction processing pipeline', async () => {
      mockPrismaScriptFindUnique.mockResolvedValue({
        turns: [
          { speaker: 'HOST', text: 'Welcome!' },
          { speaker: 'EXPERT', text: 'Glad to be here.' },
          { speaker: 'HOST', text: 'Let us talk about AI.' },
        ],
      });
      mockGenerateResponse.mockResolvedValue({
        content: 'AI stands for Artificial Intelligence, which refers to...',
        inputTokens: 180,
        outputTokens: 65,
      });

      const job = createMockJob({
        podcastId: 'podcast-final',
        interactionId: 'interaction-final',
        userId: 'user-final',
        question: 'What is AI?',
        timestamp: 30,
      });

      await processInteraction(job);

      expect(mockPrismaScriptFindUnique).toHaveBeenCalledWith({
        where: { podcastId: 'podcast-final' },
      });

      expect(mockGenerateResponse).toHaveBeenCalled();

      expect(mockPrismaInteractionUpdate).toHaveBeenCalledWith({
        where: { id: 'interaction-final' },
        data: {
          answer: 'AI stands for Artificial Intelligence, which refers to...',
          status: 'ANSWERED',
          segmentOrder: 2,
        },
      });

      expect(mockLogUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'anthropic',
          category: 'interaction',
          inputTokens: 180,
          outputTokens: 65,
          podcastId: 'podcast-final',
          userId: 'user-final',
        })
      );

      expect(job.updateProgress).toHaveBeenCalledTimes(3);
    });
  });
});
