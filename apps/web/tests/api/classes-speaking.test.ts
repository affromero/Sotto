import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---- Auth mock ----

const mockAuthenticateRequest = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

// ---- Prisma mock ----

const mockCourseClassFindFirst = vi.fn();
const mockSpeakingPromptFindFirst = vi.fn();
const mockSpeakingRecordingCreate = vi.fn();
const mockSpeakingRecordingFindFirst = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mock = {
    courseClass: {
      findFirst: (...args: unknown[]) => mockCourseClassFindFirst(...args),
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

const mockUploadFile = vi
  .fn()
  .mockResolvedValue('https://r2.example.com/speaking/user-001/prompt-001/uuid.webm');

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

import { POST, GET } from '@/app/api/v1/classes/[classId]/speaking/[promptId]/route';

// ---- Helpers ----

function routeParams(classId: string, promptId: string) {
  return { params: Promise.resolve({ classId, promptId }) };
}

function makeGetRequest(url: string): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}

/**
 * Build a POST request that mocks formData() to avoid Node.js multipart parsing
 * issues in the test environment (same pattern used by tests/api/v1/voices.test.ts).
 */
function makePostRequest(
  _classId: string,
  _promptId: string,
  audioFile?: { arrayBuffer: () => Promise<ArrayBuffer>; type: string } | null
): NextRequest {
  const fileEntry = audioFile ?? null;
  return {
    formData: async () =>
      ({ get: (key: string) => (key === 'audio' ? fileEntry : null) }) as unknown as FormData,
  } as unknown as NextRequest;
}

function makeAudioFile(type = 'audio/webm') {
  // Lead with the WebM/EBML magic bytes so detectAudioFormat() recognizes the
  // container the browser's MediaRecorder produces (the upload route derives the
  // R2 key extension + content-type from the bytes, not the declared MIME).
  const bytes = new Uint8Array(64);
  bytes.set([0x1a, 0x45, 0xdf, 0xa3], 0);
  return {
    arrayBuffer: async () => bytes.buffer,
    type,
  };
}

function makeEmptyAudioFile(type = 'audio/webm') {
  return {
    arrayBuffer: async () => new ArrayBuffer(0),
    type,
  };
}

function makeGarbageAudioFile(type = 'audio/webm') {
  // Random bytes that match no known audio container magic.
  const bytes = new Uint8Array([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0]);
  return {
    arrayBuffer: async () => bytes.buffer,
    type,
  };
}

// ---- Tests ----

describe('POST /api/v1/classes/[classId]/speaking/[promptId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
    mockCourseClassFindFirst.mockResolvedValue({ id: 'class-001' });
    mockSpeakingPromptFindFirst.mockResolvedValue({ id: 'prompt-001', sectionId: 'sec-001' });
    mockSpeakingRecordingCreate.mockResolvedValue({ id: 'rec-001', status: 'PENDING' });
    mockUploadFile.mockResolvedValue(
      'https://r2.example.com/speaking/user-001/prompt-001/uuid.webm'
    );
    mockAddJob.mockResolvedValue({ id: 'job-001' });
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    const req = makePostRequest('class-001', 'prompt-001', makeAudioFile());
    const res = await POST(req, routeParams('class-001', 'prompt-001'));
    expect(res.status).toBe(401);
  });

  it('returns 404 when class does not belong to user', async () => {
    mockCourseClassFindFirst.mockResolvedValue(null);
    const req = makePostRequest('class-999', 'prompt-001', makeAudioFile());
    const res = await POST(req, routeParams('class-999', 'prompt-001'));
    expect(res.status).toBe(404);
  });

  it('returns 404 when prompt does not belong to class', async () => {
    mockSpeakingPromptFindFirst.mockResolvedValue(null);
    const req = makePostRequest('class-001', 'prompt-999', makeAudioFile());
    const res = await POST(req, routeParams('class-001', 'prompt-999'));
    expect(res.status).toBe(404);
  });

  it('returns 400 when audio field is missing', async () => {
    const req = makePostRequest('class-001', 'prompt-001', null);
    const res = await POST(req, routeParams('class-001', 'prompt-001'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for a zero-byte audio upload without storing or queuing', async () => {
    const req = makePostRequest('class-001', 'prompt-001', makeEmptyAudioFile());
    const res = await POST(req, routeParams('class-001', 'prompt-001'));

    expect(res.status).toBe(400);
    expect(mockUploadFile).not.toHaveBeenCalled();
    expect(mockSpeakingRecordingCreate).not.toHaveBeenCalled();
    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it('returns 400 for random non-audio bytes without storing or queuing', async () => {
    const req = makePostRequest('class-001', 'prompt-001', makeGarbageAudioFile());
    const res = await POST(req, routeParams('class-001', 'prompt-001'));

    expect(res.status).toBe(400);
    expect(mockUploadFile).not.toHaveBeenCalled();
    expect(mockSpeakingRecordingCreate).not.toHaveBeenCalled();
    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it('creates a PENDING SpeakingRecording and returns 201', async () => {
    const req = makePostRequest('class-001', 'prompt-001', makeAudioFile());
    const res = await POST(req, routeParams('class-001', 'prompt-001'));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ recordingId: 'rec-001', status: 'PENDING' });
  });

  it('uploads audio to R2 with a key containing userId and promptId', async () => {
    const req = makePostRequest('class-001', 'prompt-001', makeAudioFile());
    await POST(req, routeParams('class-001', 'prompt-001'));

    expect(mockUploadFile).toHaveBeenCalledOnce();
    const [key, , contentType] = mockUploadFile.mock.calls[0];
    expect(key).toMatch(/^speaking\/user-001\/prompt-001\//);
    expect(key).toMatch(/\.webm$/);
    expect(contentType).toBe('audio/webm');
  });

  it('creates SpeakingRecording with correct sectionId and status PENDING', async () => {
    const req = makePostRequest('class-001', 'prompt-001', makeAudioFile());
    await POST(req, routeParams('class-001', 'prompt-001'));

    expect(mockSpeakingRecordingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sectionId: 'sec-001',
          promptId: 'prompt-001',
          userId: 'user-001',
          status: 'PENDING',
        }),
      })
    );
  });

  it('enqueues a SPEAKING_GRADING job with the new recordingId', async () => {
    const req = makePostRequest('class-001', 'prompt-001', makeAudioFile());
    await POST(req, routeParams('class-001', 'prompt-001'));

    expect(mockAddJob).toHaveBeenCalledWith(expect.anything(), 'speaking_grading', {
      recordingId: 'rec-001',
    });
  });
});

describe('GET /api/v1/classes/[classId]/speaking/[promptId]', () => {
  const SCORED_RECORDING = {
    id: 'rec-001',
    status: 'SCORED',
    overallScore: 0.82,
    transcript: 'Guten Morgen',
    rubricScores: { accuracy: 0.85, fluency: 0.78, completeness: 0.9 },
    feedback: 'Good attempt!',
    phonemeScores: [{ op: 'match', expected: 'guten', actual: 'guten' }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
    mockCourseClassFindFirst.mockResolvedValue({ id: 'class-001' });
    mockSpeakingRecordingFindFirst.mockResolvedValue(SCORED_RECORDING);
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    const req = makeGetRequest(
      'http://localhost/api/v1/classes/class-001/speaking/prompt-001?recordingId=rec-001'
    );
    const res = await GET(req, routeParams('class-001', 'prompt-001'));
    expect(res.status).toBe(401);
  });

  it('returns 400 when recordingId is missing', async () => {
    const req = makeGetRequest('http://localhost/api/v1/classes/class-001/speaking/prompt-001');
    const res = await GET(req, routeParams('class-001', 'prompt-001'));
    expect(res.status).toBe(400);
  });

  it('returns 404 when class does not belong to user', async () => {
    mockCourseClassFindFirst.mockResolvedValue(null);
    const req = makeGetRequest(
      'http://localhost/api/v1/classes/class-999/speaking/prompt-001?recordingId=rec-001'
    );
    const res = await GET(req, routeParams('class-999', 'prompt-001'));
    expect(res.status).toBe(404);
  });

  it('returns 404 when recording not found or not owned by user', async () => {
    mockSpeakingRecordingFindFirst.mockResolvedValue(null);
    const req = makeGetRequest(
      'http://localhost/api/v1/classes/class-001/speaking/prompt-001?recordingId=rec-999'
    );
    const res = await GET(req, routeParams('class-001', 'prompt-001'));
    expect(res.status).toBe(404);
  });

  it('returns scored fields when grading is complete', async () => {
    const req = makeGetRequest(
      'http://localhost/api/v1/classes/class-001/speaking/prompt-001?recordingId=rec-001'
    );
    const res = await GET(req, routeParams('class-001', 'prompt-001'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      status: 'SCORED',
      overallScore: 0.82,
      transcript: 'Guten Morgen',
      rubricScores: { accuracy: 0.85, fluency: 0.78, completeness: 0.9 },
      feedback: 'Good attempt!',
      phonemeScores: [{ op: 'match', expected: 'guten', actual: 'guten' }],
    });
  });

  it('returns PENDING status with null score fields when still grading', async () => {
    mockSpeakingRecordingFindFirst.mockResolvedValue({
      id: 'rec-001',
      status: 'PENDING',
      overallScore: null,
      transcript: null,
      rubricScores: null,
      feedback: null,
      phonemeScores: null,
    });
    const req = makeGetRequest(
      'http://localhost/api/v1/classes/class-001/speaking/prompt-001?recordingId=rec-001'
    );
    const res = await GET(req, routeParams('class-001', 'prompt-001'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('PENDING');
    expect(body.overallScore).toBeNull();
  });

  it('scopes the recording lookup to the authenticated user', async () => {
    const req = makeGetRequest(
      'http://localhost/api/v1/classes/class-001/speaking/prompt-001?recordingId=rec-001'
    );
    await GET(req, routeParams('class-001', 'prompt-001'));

    expect(mockSpeakingRecordingFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-001' }),
      })
    );
  });
});
