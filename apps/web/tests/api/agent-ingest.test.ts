import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockRequireAdmin = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockGetJobPriority = vi.fn();
const mockIsModelAllowedForUser = vi.fn();
const mockGetModelRequiredPlan = vi.fn();
const mockGetProviderForModel = vi.fn();
const mockIsValidModelId = vi.fn();
const mockAddJob = vi.fn();
const mockGeneratePodcastSlug = vi.fn();
const mockPodcastCreate = vi.fn();
const mockPodcastUpdate = vi.fn();
const mockDiscoveryCreate = vi.fn();
const mockAgentIngestionCreate = vi.fn();
const mockAgentIngestionFindUnique = vi.fn();
const mockTransaction = vi.fn();

const txProxy = {
  podcast: {
    create: (...args: unknown[]) => mockPodcastCreate(...args),
  },
  discovery: {
    create: (...args: unknown[]) => mockDiscoveryCreate(...args),
  },
  agentIngestion: {
    create: (...args: unknown[]) => mockAgentIngestionCreate(...args),
  },
};

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: (...args: unknown[]) => mockTransaction(...args),
    podcast: {
      update: (...args: unknown[]) => mockPodcastUpdate(...args),
    },
    agentIngestion: {
      findUnique: (...args: unknown[]) => mockAgentIngestionFindUnique(...args),
    },
  },
}));

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/auth-guards', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));

vi.mock('@/lib/redis', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

vi.mock('@/lib/generation-features', () => ({
  getJobPriority: (...args: unknown[]) => mockGetJobPriority(...args),
  isModelAllowedForUser: (...args: unknown[]) => mockIsModelAllowedForUser(...args),
}));

vi.mock('@/lib/providers/ai-registry', () => ({
  getModelRequiredPlan: (...args: unknown[]) => mockGetModelRequiredPlan(...args),
  getProviderForModel: (...args: unknown[]) => mockGetProviderForModel(...args),
  isValidModelId: (...args: unknown[]) => mockIsValidModelId(...args),
}));

vi.mock('@/lib/queue', () => ({
  contentExtractionQueue: 'content-extraction-queue',
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: { EXTRACT_CONTENT: 'EXTRACT_CONTENT' },
}));

vi.mock('@/lib/slugify', () => ({
  generatePodcastSlug: (...args: unknown[]) => mockGeneratePodcastSlug(...args),
}));

import { POST } from '@/app/api/v1/ingest/agent/route';

function createRequest(body: unknown, authHeader?: string): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authHeader) {
    headers.authorization = authHeader;
  }

  return new NextRequest('http://localhost:3000/api/v1/ingest/agent', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const validPayload = {
  title: 'Daily engineering notes',
  topic: 'Summarize the local agent run and decisions',
  content: 'The agent fixed the billing import bug, added regression tests, and left one follow-up.',
  idempotencyKey: 'claude-code:run-123',
  sourceUrl: 'https://example.com/runs/123',
  durationTarget: 8,
  focusAreas: ['billing', 'tests'],
  agent: {
    provider: 'claude-code',
    name: 'Claude Code',
    model: 'claude-code:sonnet',
    runId: 'run-123',
  },
  aiModel: 'claude-code:sonnet',
  ttsProvider: 'openai',
  ttsModel: 'gpt-4o-mini-tts',
};

describe('POST /api/v1/ingest/agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockRequireAdmin.mockResolvedValue(null);
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 19, resetAt: Date.now() });
    mockGetJobPriority.mockReturnValue(1);
    mockIsModelAllowedForUser.mockReturnValue(true);
    mockGetModelRequiredPlan.mockReturnValue(null);
    mockGetProviderForModel.mockReturnValue('claude-code');
    mockIsValidModelId.mockReturnValue(true);
    mockAgentIngestionFindUnique.mockResolvedValue(null);
    mockPodcastCreate.mockResolvedValue({ id: 'pod-agent-1', status: 'EXTRACTING' });
    mockDiscoveryCreate.mockResolvedValue({ id: 'disc-agent-1' });
    mockAgentIngestionCreate.mockResolvedValue({ id: 'ingest-1' });
    mockPodcastUpdate.mockResolvedValue({ id: 'pod-agent-1' });
    mockGeneratePodcastSlug.mockResolvedValue('daily-engineering-notes');
    mockAddJob.mockResolvedValue(undefined);
    mockTransaction.mockImplementation(async (callback: (tx: typeof txProxy) => unknown) =>
      callback(txProxy)
    );
  });

  it('requires authentication', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await POST(createRequest(validPayload));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
    expect(mockPodcastCreate).not.toHaveBeenCalled();
  });

  it('requires an explicit TTS provider', async () => {
    const payload: Partial<typeof validPayload> = { ...validPayload };
    delete payload.ttsProvider;

    const response = await POST(createRequest(payload));

    expect(response.status).toBe(400);
    expect(mockPodcastCreate).not.toHaveBeenCalled();
    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it('creates a private AGENT podcast from an API-key request', async () => {
    const response = await POST(createRequest(validPayload, 'Bearer sk_sotto_test'));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      id: 'pod-agent-1',
      status: 'EXTRACTING',
      source: 'AGENT',
      discoveryId: 'disc-agent-1',
    });
    expect(mockPodcastCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        title: validPayload.title,
        topic: validPayload.topic,
        status: 'EXTRACTING',
        source: 'AGENT',
        sourcePlatform: 'claude-code',
        visibility: 'PRIVATE',
        aiProvider: 'claude-code',
        aiModel: 'claude-code:sonnet',
        ttsProvider: 'openai',
        ttsModel: 'gpt-4o-mini-tts',
      }),
    });
    expect(mockDiscoveryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        podcastId: 'pod-agent-1',
        sourceUrl: validPayload.sourceUrl,
        sourceContent: expect.stringContaining(validPayload.content),
        sourceMetadata: expect.objectContaining({
          kind: 'agent-output',
          contentHash: expect.any(String),
          agent: expect.objectContaining({
            provider: 'claude-code',
            name: 'Claude Code',
            runId: 'run-123',
          }),
        }),
      }),
    });
    expect(mockAgentIngestionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        podcastId: 'pod-agent-1',
        idempotencyKey: 'claude-code:run-123',
        provider: 'claude-code',
        agentName: 'Claude Code',
        runId: 'run-123',
        contentHash: expect.any(String),
      }),
    });
    expect(mockAddJob).toHaveBeenCalledWith(
      'content-extraction-queue',
      'EXTRACT_CONTENT',
      {
        podcastId: 'pod-agent-1',
        userId: 'user-1',
        sourceText: expect.stringContaining(validPayload.content),
      },
      { priority: 1, jobId: 'agent-ingest-pod-agent-1' }
    );
  });

  it('returns the existing private podcast for a repeated idempotency key', async () => {
    mockAgentIngestionFindUnique.mockResolvedValue({
      podcast: { id: 'pod-existing', status: 'READY' },
    });

    const response = await POST(createRequest(validPayload));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: 'pod-existing',
      status: 'READY',
      source: 'AGENT',
      idempotent: true,
    });
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockAddJob).not.toHaveBeenCalled();
  });

});
