// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const boundary = vi.hoisted(() => ({
  authenticate: vi.fn(),
  admit: vi.fn(),
  deliver: vi.fn(),
  status: vi.fn(),
}));
vi.mock('@/lib/api-keys', () => ({ authenticateRequest: boundary.authenticate }));
vi.mock('@/lib/learning/classes/speaking/assessment-speaking-admission', () => ({
  admitAssessmentSpeaking: boundary.admit,
}));
vi.mock('@/lib/learning/classes/speaking/lifecycle/assessment-speaking-recovery', () => ({
  readAssessmentSpeakingStatus: boundary.status,
}));
vi.mock('@/lib/sidedoor/jobs/core/job-delivery', () => ({ deliverSottoJob: boundary.deliver }));
vi.mock('@/lib/queue', () => ({ speakingGradingQueue: {} }));
vi.mock('@/lib/prisma', () => ({ prismaUnfiltered: {} }));
vi.mock('@/lib/sidedoor/access/state/transaction', () => ({
  sottoTransaction: async (...args: [unknown, (tx: object) => unknown]) => args[1]({}),
}));
vi.mock('@/lib/sidedoor/credentials/runtime/provider-execution', () => ({
  sottoRequestExecution: (...args: [Request, object]) => args[1],
}));

import { POST } from '@/app/api/v1/classes/[classId]/assessment/[assessmentId]/speaking/[promptId]/route';
import { AssessmentFenceConflict } from '@/lib/learning/classes/lifecycle/assessment-fence';

const params = {
  params: Promise.resolve({ classId: 'class', assessmentId: 'assessment', promptId: 'prompt' }),
};
const requestId = '10000000-0000-4000-8000-000000000001';
function upload(form: FormData) {
  return POST(
    new NextRequest('http://localhost/api/speaking', {
      method: 'POST',
      headers: { authorization: 'Bearer fixture' },
      body: form,
    }),
    params
  );
}
function recording(bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])) {
  const form = new FormData();
  form.append('requestId', requestId);
  form.append('audio', new Blob([bytes], { type: 'audio/pretend' }), 'recording');
  return form;
}
beforeEach(() => {
  vi.resetAllMocks();
  boundary.authenticate.mockResolvedValue({ userId: 'learner' });
  boundary.admit.mockResolvedValue({
    id: requestId,
    operationId: requestId,
    fingerprint: 'a'.repeat(64),
    status: 'PENDING',
  });
  boundary.deliver.mockResolvedValue('delivered');
  boundary.status.mockResolvedValue({ status: 'RUNNING', requestId });
});

describe('assessment speaking upload', () => {
  it('requires authentication', async () => {
    boundary.authenticate.mockResolvedValue(null);
    expect((await upload(recording())).status).toBe(401);
  });

  it('accepts recognized audio and returns only its saved status', async () => {
    const response = await upload(recording());
    expect(response.status).toBe(202);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({ status: 'RUNNING', requestId });
  });

  it('does not expose unexpected private status fields', async () => {
    boundary.status.mockResolvedValue({
      status: 'RUNNING',
      requestId,
      transcript: 'private',
      score: 0.8,
    });
    const response = await upload(recording());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('private');
  });

  it('rejects missing, duplicate or invalid fields before admission', async () => {
    const missing = new FormData();
    const duplicate = recording();
    duplicate.append('requestId', requestId);
    for (const form of [missing, duplicate, recording(new Uint8Array([1, 2, 3]))]) {
      expect((await upload(form)).status).toBe(400);
    }
  });

  it('rejects an oversized streamed request before admission', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let remaining = 65;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (remaining-- > 0) controller.enqueue(chunk);
        else controller.close();
      },
    });
    const request = new NextRequest('http://localhost/api/speaking', {
      method: 'POST',
      headers: {
        authorization: 'Bearer fixture',
        'content-type': 'multipart/form-data; boundary=test',
      },
      body,
      duplex: 'half',
    } as ConstructorParameters<typeof NextRequest>[1] & { duplex: 'half' });
    expect((await POST(request, params)).status).toBe(413);
  });

  it('reports uncertain delivery and tells the learner to check saved status', async () => {
    boundary.deliver.mockRejectedValue(new Error('private queue details'));
    const response = await upload(recording());
    expect(response.status).toBe(503);
    const body = JSON.stringify(await response.json());
    expect(body).toContain('Check its status');
    expect(body).not.toContain('private queue details');
  });

  it('returns a saved status after a temporary status-check failure', async () => {
    boundary.status.mockRejectedValueOnce(new AssessmentFenceConflict());
    const uncertain = await upload(recording());
    expect(uncertain.status).toBe(503);
    expect(JSON.stringify(await uncertain.json())).toContain('Check its status');
    const replay = await upload(recording());
    expect(replay.status).toBe(202);
    expect(await replay.json()).toEqual({ status: 'RUNNING', requestId });
  });

  it('does not confirm a saved response without its request ID', async () => {
    boundary.status.mockResolvedValue({ status: 'RUNNING' });
    const response = await upload(recording());
    expect(response.status).toBe(503);
  });

  it('does not redeliver a confirmed failed response', async () => {
    boundary.admit.mockResolvedValue({
      id: requestId,
      operationId: requestId,
      fingerprint: 'a'.repeat(64),
      status: 'FAILED',
    });
    boundary.status.mockResolvedValue({ status: 'FAILED', requestId });
    const response = await upload(recording());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'FAILED', requestId });
    expect(boundary.deliver).not.toHaveBeenCalled();
  });
});
