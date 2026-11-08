// @vitest-environment node
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

const mockCreateSpeakingRecording = vi.fn().mockResolvedValue({
  id: 'rec-001',
  audioUrl: 'https://storage.example.com/speaking/recording.webm',
  status: 'PENDING',
  operationId: '10000000-0000-4000-8000-000000000001',
  fingerprint: 'a'.repeat(64),
});

vi.mock('@/lib/sidedoor/storage/publication/speaking-recording-upload', () => ({
  ClassSpeakingBindingConflict: class ClassSpeakingBindingConflict extends Error {},
  createSpeakingRecording: (...args: unknown[]) => mockCreateSpeakingRecording(...args),
}));

// ---- Queue mock ----

const mockEnqueueDurableJob = vi.fn().mockResolvedValue({ id: 'job-001' });
const mockDeliverSottoJob = vi.fn().mockResolvedValue('delivered');

vi.mock('@/lib/queue', () => ({
  admitDurableJob: (...args: unknown[]) => mockEnqueueDurableJob(...args),
  speakingGradingQueue: {},
  JobType: { SPEAKING_GRADING: 'speaking_grading' },
}));
vi.mock('@/lib/sidedoor/jobs/core/job-delivery', () => ({
  deliverSottoJob: (...args: unknown[]) => mockDeliverSottoJob(...args),
}));

// ---- Logger mock ----

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---- Imports under test ----

import { POST, GET } from '@/app/api/v1/classes/[classId]/speaking/[promptId]/route';
import { InitialA1PracticeBlocked } from '@/lib/classes/lesson/initial-a1-provenance';
import { ClassSpeakingBindingConflict } from '@/lib/sidedoor/storage/publication/speaking-recording-upload';

// ---- Helpers ----

function routeParams(classId: string, promptId: string) {
  return { params: Promise.resolve({ classId, promptId }) };
}

function makeGetRequest(url: string): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}

function makePostRequest(
  classId: string,
  promptId: string,
  audioFile?: Blob | null,
  fields: Record<string, unknown[] | undefined> = {
    expectedAttempt: ['1'],
    taskMaterialRevision: ['a'.repeat(64)],
  }
): NextRequest {
  const form = new FormData();
  if (audioFile) form.append('audio', audioFile, 'recording.webm');
  for (const [key, values] of Object.entries(fields)) {
    for (const value of values ?? []) {
      if (typeof value === 'string' || value instanceof Blob) form.append(key, value);
    }
  }
  return new NextRequest(`http://localhost/api/v1/classes/${classId}/speaking/${promptId}`, {
    method: 'POST',
    body: form,
  });
}

function makeAudioFile(type = 'audio/webm') {
  // Lead with the WebM/EBML magic bytes so detectAudioFormat() recognizes the
  // container the browser's MediaRecorder produces (the upload route derives the
  // R2 key extension + content-type from the bytes, not the declared MIME).
  const bytes = new Uint8Array(64);
  bytes.set([0x1a, 0x45, 0xdf, 0xa3], 0);
  return new Blob([bytes], { type });
}

function makeEmptyAudioFile(type = 'audio/webm') {
  return new Blob([], { type });
}

function makeGarbageAudioFile(type = 'audio/webm') {
  // Random bytes that match no known audio container magic.
  const bytes = new Uint8Array([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0]);
  return new Blob([bytes], { type });
}

// ---- Tests ----

describe('POST /api/v1/classes/[classId]/speaking/[promptId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-001' });
    mockCourseClassFindFirst.mockResolvedValue({ id: 'class-001' });
    mockSpeakingPromptFindFirst.mockResolvedValue({ id: 'prompt-001', sectionId: 'sec-001' });
    mockSpeakingRecordingCreate.mockResolvedValue({ id: 'rec-001', status: 'PENDING' });
    mockCreateSpeakingRecording.mockResolvedValue({
      id: 'rec-001',
      status: 'PENDING',
      operationId: '10000000-0000-4000-8000-000000000001',
      fingerprint: 'a'.repeat(64),
    });
    mockEnqueueDurableJob.mockResolvedValue({ id: 'job-001' });
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
    expect(await res.json()).toMatchObject({ code: 'CLASS_RECORDING_REJECTED' });
  });

  it('returns 400 when audio field is missing', async () => {
    const req = makePostRequest('class-001', 'prompt-001', null);
    const res = await POST(req, routeParams('class-001', 'prompt-001'));
    expect(res.status).toBe(400);
  });

  it.each([
    {},
    { expectedAttempt: ['1'] },
    { expectedAttempt: ['0'], taskMaterialRevision: ['a'.repeat(64)] },
    { expectedAttempt: ['1', '2'], taskMaterialRevision: ['a'.repeat(64)] },
    { expectedAttempt: ['1'], taskMaterialRevision: ['bad'] },
    { expectedAttempt: ['1'], taskMaterialRevision: ['a'.repeat(64), 'b'.repeat(64)] },
    { expectedAttempt: [new Blob(['1'])], taskMaterialRevision: ['a'.repeat(64)] },
  ])('rejects missing or malformed class bindings before recording admission', async (fields) => {
    const response = await POST(
      makePostRequest('class-001', 'prompt-001', makeAudioFile(), fields),
      routeParams('class-001', 'prompt-001')
    );
    expect(response.status).toBe(400);
    expect(mockCreateSpeakingRecording).not.toHaveBeenCalled();
    expect(mockDeliverSottoJob).not.toHaveBeenCalled();
  });

  it('returns 400 for a zero-byte audio upload without storing or queuing', async () => {
    const req = makePostRequest('class-001', 'prompt-001', makeEmptyAudioFile());
    const res = await POST(req, routeParams('class-001', 'prompt-001'));

    expect(res.status).toBe(400);
    expect(mockCreateSpeakingRecording).not.toHaveBeenCalled();
    expect(mockSpeakingRecordingCreate).not.toHaveBeenCalled();
    expect(mockDeliverSottoJob).not.toHaveBeenCalled();
  });

  it('rejects an oversized streamed upload before storing or queuing', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let remaining = 65;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (remaining-- > 0) controller.enqueue(chunk);
        else controller.close();
      },
    });
    const request = new NextRequest(
      'http://localhost/api/v1/classes/class-001/speaking/prompt-001',
      {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=test' },
        body,
        duplex: 'half',
      } as ConstructorParameters<typeof NextRequest>[1] & { duplex: 'half' }
    );
    const response = await POST(request, routeParams('class-001', 'prompt-001'));
    expect(response.status).toBe(413);
    expect(mockCreateSpeakingRecording).not.toHaveBeenCalled();
    expect(mockDeliverSottoJob).not.toHaveBeenCalled();
  });

  it('returns 400 for random non-audio bytes without storing or queuing', async () => {
    const req = makePostRequest('class-001', 'prompt-001', makeGarbageAudioFile());
    const res = await POST(req, routeParams('class-001', 'prompt-001'));

    expect(res.status).toBe(400);
    expect(mockCreateSpeakingRecording).not.toHaveBeenCalled();
    expect(mockSpeakingRecordingCreate).not.toHaveBeenCalled();
    expect(mockDeliverSottoJob).not.toHaveBeenCalled();
  });

  it('creates a PENDING SpeakingRecording and returns 201', async () => {
    const req = makePostRequest('class-001', 'prompt-001', makeAudioFile());
    const res = await POST(req, routeParams('class-001', 'prompt-001'));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ recordingId: 'rec-001', status: 'PENDING' });
  });

  it('returns a conflict before publishing a recording when teaching is not acknowledged', async () => {
    mockCreateSpeakingRecording.mockRejectedValue(new InitialA1PracticeBlocked());
    const res = await POST(
      makePostRequest('class-001', 'prompt-001', makeAudioFile()),
      routeParams('class-001', 'prompt-001')
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'PREREQUISITE_ACK_REQUIRED' });
    expect(mockDeliverSottoJob).not.toHaveBeenCalled();
  });

  it('returns a definite material conflict without delivering a grading job', async () => {
    mockCreateSpeakingRecording.mockRejectedValue(new ClassSpeakingBindingConflict());
    const res = await POST(
      makePostRequest('class-001', 'prompt-001', makeAudioFile()),
      routeParams('class-001', 'prompt-001')
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'CLASS_MATERIAL_CHANGED' });
    expect(mockDeliverSottoJob).not.toHaveBeenCalled();
  });

  it('publishes audio with captured ownership and the class parent', async () => {
    const req = makePostRequest('class-001', 'prompt-001', makeAudioFile());
    await POST(req, routeParams('class-001', 'prompt-001'));

    expect(mockCreateSpeakingRecording).toHaveBeenCalledWith(
      expect.objectContaining({
        admission: { userId: 'user-001' },
        promptId: 'prompt-001',
        parent: { sectionId: 'sec-001' },
        classBinding: {
          classId: 'class-001',
          expectedAttempt: 1,
          taskMaterialRevision: 'a'.repeat(64),
        },
        extension: 'webm',
        contentType: 'audio/webm',
      })
    );
  });

  it('creates SpeakingRecording with correct sectionId and status PENDING', async () => {
    const req = makePostRequest('class-001', 'prompt-001', makeAudioFile());
    await POST(req, routeParams('class-001', 'prompt-001'));

    expect(mockCreateSpeakingRecording).toHaveBeenCalledOnce();
  });

  it('enqueues a SPEAKING_GRADING job with the new recordingId', async () => {
    const req = makePostRequest('class-001', 'prompt-001', makeAudioFile());
    await POST(req, routeParams('class-001', 'prompt-001'));

    expect(mockDeliverSottoJob).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: '10000000-0000-4000-8000-000000000001',
        fingerprint: 'a'.repeat(64),
        version: 2,
      })
    );
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
    mockSpeakingPromptFindFirst.mockResolvedValue({ sectionId: 'sec-001' });
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

  it('returns 404 when the recording is no longer in the owned class', async () => {
    mockSpeakingRecordingFindFirst.mockResolvedValue(null);
    const req = makeGetRequest(
      'http://localhost/api/v1/classes/class-001/speaking/prompt-001?recordingId=rec-999'
    );
    const res = await GET(req, routeParams('class-001', 'prompt-001'));
    expect(res.status).toBe(404);
  });

  it('does not expose a recording when its prompt belongs to a different class', async () => {
    mockSpeakingPromptFindFirst.mockResolvedValue(null);
    const req = makeGetRequest(
      'http://localhost/api/v1/classes/class-001/speaking/other?recordingId=rec-001'
    );
    expect((await GET(req, routeParams('class-001', 'other'))).status).toBe(404);
    expect(mockSpeakingRecordingFindFirst).not.toHaveBeenCalled();
  });

  it('returns scored fields when grading is complete', async () => {
    const req = makeGetRequest(
      'http://localhost/api/v1/classes/class-001/speaking/prompt-001?recordingId=rec-001'
    );
    const res = await GET(req, routeParams('class-001', 'prompt-001'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      recordingId: 'rec-001',
      status: 'SCORED',
      recoveryAcknowledged: false,
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
    expect(body.recordingId).toBe('rec-001');
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
