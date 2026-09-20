import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockReadLocalObject = vi.fn();
vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...a: unknown[]) => mockAuthenticateRequest(...a),
}));
vi.mock('@/lib/r2', () => ({
  readLocalObject: (...a: unknown[]) => mockReadLocalObject(...a),
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

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
  mockReadLocalObject.mockResolvedValue({
    body: AUDIO,
    size: AUDIO.length,
    contentType: 'audio/mpeg',
    start: 0,
    end: AUDIO.length - 1,
  });
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
    mockReadLocalObject.mockResolvedValue({
      body: Buffer.from('2345'),
      size: AUDIO.length,
      contentType: 'audio/mpeg',
      start: 2,
      end: 5,
    });
    const res = await GET(request('bytes=2-5'), params('speaking-ref', 'abc', '0.mp3'));

    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('2345');
  });

  it('serves an open-ended range to the end of the object', async () => {
    mockReadLocalObject.mockResolvedValue({
      body: Buffer.from('789'),
      size: AUDIO.length,
      contentType: 'audio/mpeg',
      start: 7,
      end: 9,
    });
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
    mockReadLocalObject.mockResolvedValue(null);
    const res = await GET(request(), params('speaking-ref', 'nope', '0.mp3'));

    expect(res.status).toBe(404);
  });

  it('refuses a key that escapes the storage root', async () => {
    mockReadLocalObject.mockRejectedValue(new Error('Invalid storage key'));
    const res = await GET(request(), params('..', '..', 'etc', 'passwd'));

    expect(res.status).toBe(404);
  });

  it('404s an unsatisfiable range instead of serving the whole object', async () => {
    mockReadLocalObject.mockResolvedValue(null);
    const res = await GET(request('bytes=99-200'), params('speaking-ref', 'abc', '0.mp3'));

    expect(res.status).toBe(404);
  });
});
