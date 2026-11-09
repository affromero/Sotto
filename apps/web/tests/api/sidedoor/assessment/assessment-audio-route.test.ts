// @vitest-environment node
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  userId: 'owner',
  allowed: true,
  bytes: Buffer.alloc(140_000, 7),
  digest: '',
  declaredSize: null as number | null,
  gate: null as Promise<void> | null,
  reads: 0,
}));
vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: async () => ({ userId: boundary.userId }),
}));
vi.mock('@/lib/prisma', () => ({ prismaUnfiltered: {} }));
vi.mock('@/lib/sidedoor/access/state/transaction', () => ({
  sottoTransaction: async (_database: unknown, operation: (tx: object) => unknown) => operation({}),
}));
vi.mock('@/lib/sidedoor/credentials/runtime/provider-execution', () => ({
  sottoRequestExecution: (_request: unknown, identity: { userId: string }) => ({
    userId: identity.userId,
    authorize: async () => ({ userId: identity.userId }),
  }),
}));
vi.mock('@/lib/learning/classes/audio/assessment-audio-read', () => ({
  captureAssessmentAudio: async (_database: unknown, input: { execution: { userId: string } }) => {
    if (!boundary.allowed || input.execution.userId !== 'owner') throw new Error('Denied');
    return {
      assessmentId: 'assessment',
      classAttempt: 1,
      assessmentAttempt: 1,
      reviewedMaterialDigest: 'a'.repeat(64),
      source: {
        kind: 'LISTENING',
        sectionId: 'section',
        contentBytes: boundary.declaredSize ?? boundary.bytes.length,
        contentSha256: boundary.digest,
      },
      storage: { input: { key: 'audio.mp3' }, backend: { descriptor: { kind: 'local' } } },
    };
  },
}));
vi.mock('@/lib/r2', () => ({
  STORAGE_RANGE_MAX_BYTES: 512 * 1024,
  readAssessmentAudioRange: async (
    input: { start: number; end: number },
    authorize: (database: object) => Promise<void>
  ) => {
    boundary.reads += 1;
    if (boundary.gate) await boundary.gate;
    await authorize({});
    return {
      body: boundary.bytes.subarray(input.start, input.end + 1),
      size: boundary.bytes.length,
      start: input.start,
      end: input.end,
      identity: { kind: 'local', inode: 'one' },
    };
  },
}));

import { GET } from '@/app/api/v1/classes/[classId]/assessment/[assessmentId]/audio/[kind]/[itemId]/route';

const params = {
  params: Promise.resolve({
    classId: 'class',
    assessmentId: 'assessment',
    kind: 'listening',
    itemId: 'section',
  }),
};
const request = (range?: string) =>
  new NextRequest('http://localhost/audio', {
    headers: range ? { range } : {},
  });

describe('assessment audio playback', () => {
  beforeEach(() => {
    boundary.userId = 'owner';
    boundary.allowed = true;
    boundary.bytes = Buffer.alloc(140_000, 7);
    boundary.digest = createHash('sha256').update(boundary.bytes).digest('hex');
    boundary.declaredSize = null;
    boundary.gate = null;
    boundary.reads = 0;
  });

  it('serves verified owned bytes with correct range and private headers', async () => {
    const response = await GET(request('bytes=10-29'), params);
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 10-29/140000');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(boundary.bytes.subarray(10, 30));
  });

  it('rejects an altered digest, invalid range and another learner', async () => {
    boundary.digest = '0'.repeat(64);
    expect((await GET(request(), params)).status).toBe(409);
    boundary.digest = createHash('sha256').update(boundary.bytes).digest('hex');
    expect((await GET(request('bytes=0-1,3-4'), params)).status).toBe(416);
    boundary.userId = 'other';
    expect((await GET(request(), params)).status).toBe(409);
  });

  it('stops streaming after access is revoked', async () => {
    const response = await GET(request(), params);
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    expect((await reader.read()).value?.length).toBe(64 * 1024);
    boundary.allowed = false;
    await expect(reader.read()).rejects.toThrow();
  });

  it('holds its memory reservation until aborted reads finish', async () => {
    boundary.declaredSize = 64 * 1024 * 1024;
    let release!: () => void;
    boundary.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstAbort = new AbortController();
    const secondAbort = new AbortController();
    const first = GET(
      new NextRequest('http://localhost/audio', { signal: firstAbort.signal }),
      params
    );
    const second = GET(
      new NextRequest('http://localhost/audio', { signal: secondAbort.signal }),
      params
    );
    try {
      await vi.waitFor(() => expect(boundary.reads).toBe(2));
      firstAbort.abort();
      expect((await GET(request(), params)).status).toBe(503);
    } finally {
      secondAbort.abort();
      release();
    }
    expect((await first).status).toBe(409);
    expect((await second).status).toBe(409);
    boundary.gate = null;
    boundary.declaredSize = null;
    const recovered = await GET(request('bytes=0-1'), params);
    expect(recovered.status).toBe(206);
    await recovered.arrayBuffer();
  });
});
