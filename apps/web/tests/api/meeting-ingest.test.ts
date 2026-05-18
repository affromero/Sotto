import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockAuth = vi.fn();
const mockCheckSuspension = vi.fn();
const mockRequireAdmin = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockCheckGenerationGate = vi.fn();
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
const mockMeetingIngestionCreate = vi.fn();
const mockMeetingIngestionFindUnique = vi.fn();
const mockTransaction = vi.fn();

const txProxy = {
  podcast: {
    create: (...args: unknown[]) => mockPodcastCreate(...args),
  },
  discovery: {
    create: (...args: unknown[]) => mockDiscoveryCreate(...args),
  },
  meetingIngestion: {
    create: (...args: unknown[]) => mockMeetingIngestionCreate(...args),
  },
};

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: (...args: unknown[]) => mockTransaction(...args),
    podcast: {
      update: (...args: unknown[]) => mockPodcastUpdate(...args),
    },
    meetingIngestion: {
      findUnique: (...args: unknown[]) => mockMeetingIngestionFindUnique(...args),
    },
  },
}));

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/auth-guards', () => ({
  checkSuspension: (...args: unknown[]) => mockCheckSuspension(...args),
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));

vi.mock('@/lib/redis', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

vi.mock('@/lib/generation-gate', () => ({
  checkGenerationGate: (...args: unknown[]) => mockCheckGenerationGate(...args),
}));

vi.mock('@/lib/tier-features', () => ({
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

import { POST } from '@/app/api/ingest/meeting/route';

function createRequest(body: unknown, authHeader?: string): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authHeader) {
    headers.authorization = authHeader;
  }

  return new NextRequest('http://localhost:3000/api/ingest/meeting', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const validPayload = {
  title: 'Weekly planning review',
  topic: 'Summarize decisions, blockers, and owner-specific action items.',
  transcript:
    'Alex: We will ship private RSS first.\nSam: I will prepare onboarding docs.\nAlex: The meeting recorder should stay private by default.',
  idempotencyKey: 'zoom:meeting-456',
  meetingUrl: 'https://zoom.us/rec/share/456',
  platform: 'zoom',
  startedAt: '2026-05-18T14:00:00.000Z',
  endedAt: '2026-05-18T14:45:00.000Z',
  participants: [
    { name: 'Alex Romero', email: 'alex@example.com', role: 'Founder' },
    { name: 'Sam Patel', role: 'Engineering' },
  ],
  actionItems: ['Prepare the open-source install path', 'Draft hosted onboarding copy'],
  durationTarget: 10,
  focusAreas: ['decisions', 'action items'],
  aiModel: 'claude-code:sonnet',
  ttsProvider: 'openai',
  ttsModel: 'gpt-4o-mini-tts',
};

describe('POST /api/ingest/meeting', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCheckSuspension.mockReturnValue(null);
    mockRequireAdmin.mockResolvedValue(null);
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 19, resetAt: Date.now() });
    mockCheckGenerationGate.mockResolvedValue({
      allowed: true,
      reason: 'ok',
      dailyUsed: 0,
      dailyLimit: 100,
      isByokUser: true,
      isProUser: false,
    });
    mockGetJobPriority.mockReturnValue(1);
    mockIsModelAllowedForUser.mockReturnValue(true);
    mockGetModelRequiredPlan.mockReturnValue(null);
    mockGetProviderForModel.mockReturnValue('claude-code');
    mockIsValidModelId.mockReturnValue(true);
    mockMeetingIngestionFindUnique.mockResolvedValue(null);
    mockPodcastCreate.mockResolvedValue({ id: 'pod-meeting-1', status: 'EXTRACTING' });
    mockDiscoveryCreate.mockResolvedValue({ id: 'disc-meeting-1' });
    mockMeetingIngestionCreate.mockResolvedValue({ id: 'meeting-ingest-1' });
    mockPodcastUpdate.mockResolvedValue({ id: 'pod-meeting-1' });
    mockGeneratePodcastSlug.mockResolvedValue('weekly-planning-review');
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

  it('creates a private MEETING podcast from an API-key request', async () => {
    const response = await POST(createRequest(validPayload, 'Bearer sk_sotto_test'));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      id: 'pod-meeting-1',
      status: 'EXTRACTING',
      source: 'MEETING',
      discoveryId: 'disc-meeting-1',
    });
    expect(mockAuth).not.toHaveBeenCalled();
    expect(mockPodcastCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        title: validPayload.title,
        topic: validPayload.topic,
        status: 'EXTRACTING',
        source: 'MEETING',
        sourcePlatform: 'zoom',
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
        podcastId: 'pod-meeting-1',
        sourceUrl: validPayload.meetingUrl,
        sourceContent: expect.stringContaining(validPayload.transcript),
        sourceMetadata: expect.objectContaining({
          kind: 'meeting-transcript',
          transcriptHash: expect.any(String),
          platform: 'zoom',
          participants: expect.arrayContaining([
            expect.objectContaining({ name: 'Alex Romero', email: 'alex@example.com' }),
          ]),
          actionItems: validPayload.actionItems,
        }),
      }),
    });
    expect(mockDiscoveryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceContent: expect.stringContaining('## Participants'),
      }),
    });
    expect(mockDiscoveryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceContent: expect.stringContaining('## Action Items'),
      }),
    });
    expect(mockMeetingIngestionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        podcastId: 'pod-meeting-1',
        idempotencyKey: 'zoom:meeting-456',
        platform: 'zoom',
        meetingTitle: validPayload.title,
        startedAt: expect.any(Date),
        endedAt: expect.any(Date),
        transcriptHash: expect.any(String),
      }),
    });
    expect(mockAddJob).toHaveBeenCalledWith(
      'content-extraction-queue',
      'EXTRACT_CONTENT',
      {
        podcastId: 'pod-meeting-1',
        userId: 'user-1',
        sourceText: expect.stringContaining(validPayload.transcript),
      },
      { priority: 1, jobId: 'meeting-ingest-pod-meeting-1' }
    );
  });

  it('returns the existing private podcast for a repeated idempotency key', async () => {
    mockMeetingIngestionFindUnique.mockResolvedValue({
      podcast: { id: 'pod-existing', status: 'READY' },
    });

    const response = await POST(createRequest(validPayload));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: 'pod-existing',
      status: 'READY',
      source: 'MEETING',
      idempotent: true,
    });
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it('blocks ingestion when the generation gate is closed', async () => {
    mockCheckGenerationGate.mockResolvedValue({
      allowed: false,
      reason: 'generation_in_progress',
      dailyUsed: 1,
      dailyLimit: 1,
      isByokUser: false,
      isProUser: false,
    });

    const response = await POST(createRequest(validPayload));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ code: 'generation_in_progress' });
    expect(mockPodcastCreate).not.toHaveBeenCalled();
    expect(mockAddJob).not.toHaveBeenCalled();
  });
});
