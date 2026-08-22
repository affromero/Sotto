import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { NextRequest } from 'next/server';

// The route reads real bytes off disk, so the suite writes a real temp store
// rather than mocking fs — the traversal guard and the range maths are the
// behaviour under test and both depend on genuine paths and file sizes.
const storeDir = await mkdtemp(path.join(tmpdir(), 'sotto-storage-test-'));

vi.hoisted(() => {
  process.env.STORAGE_PROVIDER = 'local';
});
process.env.LOCAL_STORAGE_DIR = storeDir;

const mockAuthenticateRequest = vi.fn();
vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...a: unknown[]) => mockAuthenticateRequest(...a),
}));
vi.mock('@/lib/server-config', () => ({
  infra: (_key: string, envName: string) => process.env[envName],
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { GET } = await import('@/app/api/v1/storage/[...key]/route');

const AUDIO = Buffer.from('0123456789');

function request(range?: string): NextRequest {
  return new NextRequest('http://localhost/api/v1/storage/speaking-ref/abc/0.mp3', {
    headers: range ? { range } : undefined,
  });
}

function params(...key: string[]) {
  return { params: Promise.resolve({ key }) };
}

beforeAll(async () => {
  await mkdir(path.join(storeDir, 'speaking-ref', 'abc'), { recursive: true });
  await writeFile(path.join(storeDir, 'speaking-ref', 'abc', '0.mp3'), AUDIO);
});

afterAll(async () => {
  await rm(storeDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
});

describe('GET /api/v1/storage/[...key]', () => {
  it('serves a stored object with its content type', async () => {
    const res = await GET(request(), params('speaking-ref', 'abc', '0.mp3'));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(AUDIO);
  });

  it('returns just the requested range so audio can seek', async () => {
    const res = await GET(request('bytes=2-5'), params('speaking-ref', 'abc', '0.mp3'));

    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('2345');
  });

  it('serves an open-ended range to the end of the object', async () => {
    const res = await GET(request('bytes=7-'), params('speaking-ref', 'abc', '0.mp3'));

    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 7-9/10');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('789');
  });

  it('rejects an unauthenticated caller', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const res = await GET(request(), params('speaking-ref', 'abc', '0.mp3'));

    expect(res.status).toBe(401);
  });

  it('404s a key that does not exist', async () => {
    const res = await GET(request(), params('speaking-ref', 'nope', '0.mp3'));

    expect(res.status).toBe(404);
  });

  it('refuses a key that escapes the storage root', async () => {
    const res = await GET(request(), params('..', '..', 'etc', 'passwd'));

    expect(res.status).toBe(404);
  });

  it('404s an unsatisfiable range instead of serving the whole object', async () => {
    const res = await GET(request('bytes=99-200'), params('speaking-ref', 'abc', '0.mp3'));

    expect(res.status).toBe(404);
  });
});
