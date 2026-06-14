import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---- Auth mock ----

const mockAuthenticateRequest = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

// ---- Prisma mock ----

const mockPracticeSessionFindFirst = vi.fn();
const mockSpeakingPromptFindFirst = vi.fn();
const mockSpeakingRecordingCreate = vi.fn();
const mockSpeakingRecordingFindFirst = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mock = {
    practiceSession: {
      findFirst: (...args: unknown[]) => mockPracticeSessionFindFirst(...args),
    },
    speakingPrompt: {
      findFirst: (...args: unknown[]) => mockSpeakingPromptFindFirst(...args),
    },
    speakingRecording: {
      create: (...args: unknown[]) => mockSpeakingRecordingCreate(...args),
      findFirst: (...args: unknown[]) => mockSpeakingRecordingFindFirst(...args),
    },
  };
  return { prisma: _mock, prismaUnfiltered: _mock };
});

// ---- R2 mock ----

const mockUploadFile = vi.fn().mockResolvedValue('https://r2.example.com/speaking/user-001/prompt-001/uuid.webm');

vi.mock('@/lib/r2', () => ({
  uploadFile: (...args: unknown[]) => mockUploadFile(...args),
}));

// ---- Queue mock ----

const mockAddJob = vi.fn().mockResolvedValue({ id: 'job-001' });

vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mockAddJob(...args),
  speakingGradingQueue: {},
  JobType: { SPEAKING_GRADING: 'speaking_grading' },
}));

// ---- Logger mock ----

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---- Imports under test ----

import { POST } from '@/app/api/v1/practice/[sessionId]/speaking/[promptId]/route';

// ---- Helpers ----

function routeParams(sessionId: string, promptId: string) {
  return { params: Promise.resolve({ sessionId, promptId }) };
}

/**
 * Build a POST request that mocks formData() to avoid Node.js multipart parsing
 * issues in the test environment (same pattern used by classes-speaking.test.ts).
 */
function makePostRequest(
  audioFile?: { arrayBuffer: () => Promise<ArrayBuffer>; type: string } | null,
): NextRequest {
  const fileEntry = audioFile ?? null;
  return {
    formData: async () =>
      ({ get: (key: string) => (key === 'audio' ? fileEntry : null) }) as unknown as FormData,
  } as unknown as NextRequest;
}

function makeAudioFile(type = 'audio/webm') {
  // WebM/EBML magic bytes so detectAudioFormat()/isRecognizedAudio() accept it.
  const bytes = new Uint8Array(64);
  bytes.set([0x1a, 0x45, 0xdf, 0xa3], 0);
  return { arrayBuffer: async () => bytes.buffer, type };
}

function makeEmptyAudioFile(type = 'audio/webm') {
  return { arrayBuffer: async () => new ArrayBuffer(0), type };
}

function makeGarbageAudioFile(type = 'audio/webm') {
  const bytes = new Uint8Array([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0]);
  return { arrayBuffer: async () => bytes.buffer, type };
}

// ---- Tests ----

describe('POST /api/v1/practice/[sessionId]/speaking/[promptId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
    mockPracticeSessionFindFirst.mockResolvedValue({ id: 'session-001' });
    mockSpeakingPromptFindFirst.mockResolvedValue({ id: 'prompt-001' });
    mockSpeakingRecordingCreate.mockResolvedValue({ id: 'rec-001', status: 'PENDING' });
    mockUploadFile.mockResolvedValue('https://r2.example.com/speaking/user-001/prompt-001/uuid.webm');
    mockAddJob.mockResolvedValue({ id: 'job-001' });
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    const req = makePostRequest(makeAudioFile());
    const res = await POST(req, routeParams('session-001', 'prompt-001'));
    expect(res.status).toBe(401);
  });

  it('returns 404 when session does not belong to user', async () => {
    mockPracticeSessionFindFirst.mockResolvedValue(null);
    const req = makePostRequest(makeAudioFile());
    const res = await POST(req, routeParams('session-999', 'prompt-001'));
    expect(res.status).toBe(404);
  });

  it('returns 404 when prompt does not belong to session', async () => {
    mockSpeakingPromptFindFirst.mockResolvedValue(null);
    const req = makePostRequest(makeAudioFile());
    const res = await POST(req, routeParams('session-001', 'prompt-999'));
    expect(res.status).toBe(404);
  });

  it('returns 400 when audio field is missing', async () => {
    const req = makePostRequest(null);
    const res = await POST(req, routeParams('session-001', 'prompt-001'));
    expect(res.status).toBe(400);
  });

  it('creates a PENDING SpeakingRecording and returns 201 for valid audio', async () => {
    const req = makePostRequest(makeAudioFile());
    const res = await POST(req, routeParams('session-001', 'prompt-001'));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ recordingId: 'rec-001', status: 'PENDING' });
    expect(mockUploadFile).toHaveBeenCalledOnce();
    expect(mockAddJob).toHaveBeenCalledWith(expect.anything(), 'speaking_grading', {
      recordingId: 'rec-001',
    });
  });

  it('returns 400 for a zero-byte audio upload without storing or queuing', async () => {
    const req = makePostRequest(makeEmptyAudioFile());
    const res = await POST(req, routeParams('session-001', 'prompt-001'));

    expect(res.status).toBe(400);
    expect(mockUploadFile).not.toHaveBeenCalled();
    expect(mockSpeakingRecordingCreate).not.toHaveBeenCalled();
    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it('returns 400 for random non-audio bytes without storing or queuing', async () => {
    const req = makePostRequest(makeGarbageAudioFile());
    const res = await POST(req, routeParams('session-001', 'prompt-001'));

    expect(res.status).toBe(400);
    expect(mockUploadFile).not.toHaveBeenCalled();
    expect(mockSpeakingRecordingCreate).not.toHaveBeenCalled();
    expect(mockAddJob).not.toHaveBeenCalled();
  });
});
