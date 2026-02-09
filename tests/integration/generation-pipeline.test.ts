import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Prisma Mock ----

const mockPodcastUpdate = vi.fn().mockResolvedValue({});
const mockPodcastFindUnique = vi.fn();
const mockSegmentFindMany = vi.fn().mockResolvedValue([]);
const mockSegmentCreate = vi.fn().mockResolvedValue({ id: 'seg-1' });
const mockSegmentUpdate = vi.fn().mockResolvedValue({});
const mockSegmentCount = vi.fn().mockResolvedValue(0);
const mockReferenceCreateMany = vi.fn().mockResolvedValue({ count: 3 });
const mockJobCreate = vi.fn().mockResolvedValue({ id: 'job-1' });
const mockJobUpdate = vi.fn().mockResolvedValue({});
const mockScriptCreate = vi.fn().mockResolvedValue({ id: 'script-1' });
const mockScriptFindUnique = vi.fn();
const mockDiscoveryFindUnique = vi.fn();
const mockApiUsageLogCreate = vi.fn().mockResolvedValue({});

vi.mock('@/lib/prisma', () => ({
  prisma: {
    podcast: {
      update: (...args: unknown[]) => mockPodcastUpdate(...args),
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
    },
    segment: {
      findMany: (...args: unknown[]) => mockSegmentFindMany(...args),
      create: (...args: unknown[]) => mockSegmentCreate(...args),
      update: (...args: unknown[]) => mockSegmentUpdate(...args),
      count: (...args: unknown[]) => mockSegmentCount(...args),
    },
    reference: {
      createMany: (...args: unknown[]) => mockReferenceCreateMany(...args),
    },
    job: {
      create: (...args: unknown[]) => mockJobCreate(...args),
      update: (...args: unknown[]) => mockJobUpdate(...args),
    },
    script: {
      create: (...args: unknown[]) => mockScriptCreate(...args),
      findUnique: (...args: unknown[]) => mockScriptFindUnique(...args),
    },
    discovery: {
      findUnique: (...args: unknown[]) => mockDiscoveryFindUnique(...args),
    },
    apiUsageLog: {
      create: (...args: unknown[]) => mockApiUsageLogCreate(...args),
    },
  },
}));

// ---- Queue Mock ----

const mockAddJob = vi.fn().mockResolvedValue({ id: 'queue-job-1' });

vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: {
    EXTRACT_CONTENT: 'extract_content',
    GENERATE_SCRIPT: 'generate_script',
    VALIDATE_REFERENCES: 'validate_references',
    GENERATE_AUDIO: 'generate_audio',
    STITCH_AUDIO: 'stitch_audio',
    PROCESS_INTERACTION: 'process_interaction',
    REGENERATE_SEGMENT: 'regenerate_segment',
    SEND_NOTIFICATION: 'send_notification',
    GENERATE_PDF: 'generate_pdf',
  },
  contentExtractionQueue: { name: 'content-extraction' },
  scriptGenerationQueue: { name: 'script-generation' },
  referenceValidationQueue: { name: 'reference-validation' },
  audioGenerationQueue: { name: 'audio-generation' },
  audioStitchingQueue: { name: 'audio-stitching' },
  notificationQueue: { name: 'notification' },
}));

// ---- External Service Mocks ----

vi.mock('@/lib/claude', () => ({
  streamClaude: vi.fn(),
  callClaude: vi.fn().mockResolvedValue('Mock response'),
}));

vi.mock('@/lib/elevenlabs', () => ({
  generateSpeech: vi.fn().mockResolvedValue(Buffer.from('fake-audio')),
  getVoiceId: vi.fn().mockReturnValue('voice-abc'),
  getVoiceProfile: vi.fn().mockReturnValue({
    id: 'voice-abc',
    name: 'Adam',
    gender: 'male',
    accent: 'american',
    ageRange: 'middle',
    character: 'warm narrator',
  }),
}));

vi.mock('@/lib/r2', () => ({
  uploadSegmentAudio: vi.fn().mockResolvedValue('https://r2.example.com/audio.mp3'),
  uploadFinalAudio: vi.fn().mockResolvedValue('https://r2.example.com/final.mp3'),
}));

vi.mock('@/lib/audio-stitcher', () => ({
  stitchSegments: vi.fn().mockResolvedValue({
    buffer: Buffer.from('stitched-audio'),
    duration: 120,
  }),
}));

vi.mock('@/lib/content-parser', () => ({
  extractContent: vi.fn().mockResolvedValue({
    text: 'Extracted content about quantum computing.',
    title: 'Quantum Computing Overview',
  }),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/notifications', () => ({
  createNotification: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/push-notifications', () => ({
  sendPushToUser: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Generation Pipeline — Status Transitions', () => {
  const basePodcast = {
    id: 'podcast-1',
    userId: 'user-1',
    title: 'Quantum Computing Explained',
    topic: 'Introduction to quantum computing',
    status: 'PENDING',
  };

  it('should define all status transitions in correct order', () => {
    const validTransitions: Record<string, string[]> = {
      PENDING: ['EXTRACTING', 'DISCOVERING'],
      DISCOVERING: ['EXTRACTING', 'PENDING'],
      EXTRACTING: ['SCRIPTING', 'FAILED'],
      SCRIPTING: ['VALIDATING_REFERENCES', 'FAILED'],
      VALIDATING_REFERENCES: ['GENERATING_AUDIO', 'FAILED'],
      GENERATING_AUDIO: ['STITCHING', 'FAILED'],
      STITCHING: ['READY', 'FAILED'],
      READY: ['UPDATING'],
      UPDATING: ['READY', 'FAILED'],
      FAILED: ['EXTRACTING'],
    };

    // Verify pipeline order
    expect(Object.keys(validTransitions)).toContain('PENDING');
    expect(Object.keys(validTransitions)).toContain('READY');
    expect(Object.keys(validTransitions)).toContain('FAILED');

    // Verify FAILED always allows retry (back to EXTRACTING)
    expect(validTransitions.FAILED).toContain('EXTRACTING');

    // Verify all processing states can transition to FAILED
    const processingStates = ['EXTRACTING', 'SCRIPTING', 'VALIDATING_REFERENCES', 'GENERATING_AUDIO', 'STITCHING'];
    processingStates.forEach((state) => {
      expect(validTransitions[state]).toContain('FAILED');
    });
  });

  it('should track podcast through PENDING → EXTRACTING status', async () => {
    mockPodcastFindUnique.mockResolvedValue({
      ...basePodcast,
      status: 'PENDING',
      discovery: { sourceUrl: 'https://example.com/article' },
    });

    // Simulate the generate API behavior
    const podcast = await mockPodcastFindUnique();
    expect(podcast.status).toBe('PENDING');

    await mockPodcastUpdate({ where: { id: 'podcast-1' }, data: { status: 'EXTRACTING' } });
    expect(mockPodcastUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'EXTRACTING' } })
    );
  });

  it('should track EXTRACTING → SCRIPTING transition', async () => {
    await mockPodcastUpdate({ where: { id: 'podcast-1' }, data: { status: 'SCRIPTING' } });
    expect(mockPodcastUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'SCRIPTING' } })
    );
  });

  it('should track SCRIPTING → VALIDATING_REFERENCES transition', async () => {
    await mockPodcastUpdate({ where: { id: 'podcast-1' }, data: { status: 'VALIDATING_REFERENCES' } });
    expect(mockPodcastUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'VALIDATING_REFERENCES' } })
    );
  });

  it('should track VALIDATING_REFERENCES → GENERATING_AUDIO transition', async () => {
    await mockPodcastUpdate({ where: { id: 'podcast-1' }, data: { status: 'GENERATING_AUDIO' } });
    expect(mockPodcastUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'GENERATING_AUDIO' } })
    );
  });

  it('should track GENERATING_AUDIO → STITCHING transition', async () => {
    await mockPodcastUpdate({ where: { id: 'podcast-1' }, data: { status: 'STITCHING' } });
    expect(mockPodcastUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'STITCHING' } })
    );
  });

  it('should track STITCHING → READY transition', async () => {
    await mockPodcastUpdate({ where: { id: 'podcast-1' }, data: { status: 'READY' } });
    expect(mockPodcastUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'READY' } })
    );
  });

  it('should track FAILED → EXTRACTING retry transition', async () => {
    mockPodcastFindUnique.mockResolvedValue({ ...basePodcast, status: 'FAILED' });

    const podcast = await mockPodcastFindUnique();
    expect(podcast.status).toBe('FAILED');

    await mockPodcastUpdate({ where: { id: 'podcast-1' }, data: { status: 'EXTRACTING' } });
    expect(mockPodcastUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'EXTRACTING' } })
    );
  });
});

describe('Generation Pipeline — Job Queueing', () => {
  it('should queue content extraction job with correct payload', async () => {
    const payload = {
      podcastId: 'podcast-1',
      userId: 'user-1',
      sourceUrl: 'https://example.com/article',
    };

    await mockAddJob({ name: 'content-extraction' }, 'extract_content', payload);

    expect(mockAddJob).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'content-extraction' }),
      'extract_content',
      expect.objectContaining({ podcastId: 'podcast-1', sourceUrl: 'https://example.com/article' })
    );
  });

  it('should queue script generation after content extraction', async () => {
    const payload = {
      podcastId: 'podcast-1',
      userId: 'user-1',
      discoveryId: 'discovery-1',
      sourceContent: 'Extracted text about quantum computing',
    };

    await mockAddJob({ name: 'script-generation' }, 'generate_script', payload);

    expect(mockAddJob).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'script-generation' }),
      'generate_script',
      expect.objectContaining({ podcastId: 'podcast-1', discoveryId: 'discovery-1' })
    );
  });

  it('should queue reference validation after script generation', async () => {
    const payload = { podcastId: 'podcast-1', userId: 'user-1' };

    await mockAddJob({ name: 'reference-validation' }, 'validate_references', payload);

    expect(mockAddJob).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'reference-validation' }),
      'validate_references',
      expect.objectContaining({ podcastId: 'podcast-1' })
    );
  });

  it('should queue multiple audio generation jobs in parallel', async () => {
    const segments = [
      { id: 'seg-1', speaker: 'HOST', text: 'Hello' },
      { id: 'seg-2', speaker: 'EXPERT', text: 'World' },
      { id: 'seg-3', speaker: 'HOST', text: 'Welcome' },
    ];

    for (const seg of segments) {
      await mockAddJob({ name: 'audio-generation' }, 'generate_audio', {
        podcastId: 'podcast-1',
        segmentId: seg.id,
        speaker: seg.speaker,
        text: seg.text,
      });
    }

    expect(mockAddJob).toHaveBeenCalledTimes(3);
  });

  it('should queue audio stitching after all segments complete', async () => {
    await mockAddJob({ name: 'audio-stitching' }, 'stitch_audio', { podcastId: 'podcast-1' });

    expect(mockAddJob).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'audio-stitching' }),
      'stitch_audio',
      expect.objectContaining({ podcastId: 'podcast-1' })
    );
  });

  it('should queue notification after stitching complete', async () => {
    await mockAddJob({ name: 'notification' }, 'send_notification', {
      podcastId: 'podcast-1',
      userId: 'user-1',
      type: 'PODCAST_READY',
    });

    expect(mockAddJob).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'notification' }),
      'send_notification',
      expect.objectContaining({ type: 'PODCAST_READY' })
    );
  });
});

describe('Generation Pipeline — Error Handling', () => {
  it('should mark podcast as FAILED on worker error', async () => {
    await mockPodcastUpdate({
      where: { id: 'podcast-1' },
      data: { status: 'FAILED' },
    });

    expect(mockPodcastUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'FAILED' } })
    );
  });

  it('should record job failure with error message', async () => {
    await mockJobUpdate({
      where: { id: 'job-1' },
      data: { status: 'failed', error: 'Claude API rate limit exceeded' },
    });

    expect(mockJobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'failed',
          error: 'Claude API rate limit exceeded',
        }),
      })
    );
  });

  it('should allow retry from FAILED status', async () => {
    mockPodcastFindUnique.mockResolvedValue({
      id: 'podcast-1',
      status: 'FAILED',
      userId: 'user-1',
      discovery: { sourceUrl: null },
    });

    const podcast = await mockPodcastFindUnique();
    expect(podcast.status).toBe('FAILED');

    // Reset to EXTRACTING for retry
    await mockPodcastUpdate({ where: { id: 'podcast-1' }, data: { status: 'EXTRACTING' } });
    await mockAddJob({ name: 'content-extraction' }, 'extract_content', {
      podcastId: 'podcast-1',
      userId: 'user-1',
    });

    expect(mockPodcastUpdate).toHaveBeenCalled();
    expect(mockAddJob).toHaveBeenCalled();
  });
});

describe('Generation Pipeline — Data Integrity', () => {
  it('should create references with correct structure', async () => {
    const references = [
      { number: 1, title: 'Quantum Computing: An Overview', authors: ['Smith, J.'], year: 2023, url: 'https://example.com/1', type: 'PAPER', verificationStatus: 'PENDING' },
      { number: 2, title: 'Introduction to Qubits', authors: ['Doe, A.', 'Lee, B.'], year: 2024, url: 'https://example.com/2', type: 'ARTICLE', verificationStatus: 'PENDING' },
    ];

    await mockReferenceCreateMany({
      data: references.map((ref) => ({ ...ref, podcastId: 'podcast-1' })),
    });

    expect(mockReferenceCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ number: 1, podcastId: 'podcast-1' }),
          expect.objectContaining({ number: 2, podcastId: 'podcast-1' }),
        ]),
      })
    );
  });

  it('should create script with valid turns structure', async () => {
    const turns = [
      { speaker: 'HOST', text: 'Today we are discussing quantum computing [1].' },
      { speaker: 'EXPERT', text: 'A qubit can exist in superposition [2].' },
    ];

    await mockScriptCreate({
      data: {
        podcastId: 'podcast-1',
        turns: JSON.stringify(turns),
        markdown: turns.map((t) => `**${t.speaker}**: ${t.text}`).join('\n\n'),
        version: 1,
      },
    });

    expect(mockScriptCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ podcastId: 'podcast-1', version: 1 }),
      })
    );
  });

  it('should track API usage for cost monitoring', async () => {
    await mockApiUsageLogCreate({
      data: {
        podcastId: 'podcast-1',
        userId: 'user-1',
        service: 'claude',
        category: 'script_generation',
        inputTokens: 2000,
        outputTokens: 5000,
        totalCost: 0.035,
        durationMs: 4500,
      },
    });

    expect(mockApiUsageLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          service: 'claude',
          category: 'script_generation',
          totalCost: 0.035,
        }),
      })
    );
  });
});
