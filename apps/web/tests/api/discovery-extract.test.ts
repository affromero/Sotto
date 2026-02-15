import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockExtractContent = vi.fn();
const mockCheckRateLimit = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: () => mockAuth(),
}));

vi.mock('@/lib/extractors', () => ({
  extractContent: (...args: unknown[]) => mockExtractContent(...args),
}));

vi.mock('@/lib/redis', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { POST } from '@/app/api/discovery/extract/route';

function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/discovery/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/discovery/extract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60000 });
    mockExtractContent.mockResolvedValue({
      text: 'Article text content',
      markdown: '# Article\n\nText content',
      title: 'Test Article',
      description: 'A test article',
      siteName: 'Example Site',
      author: 'Author Name',
      publishedDate: '2024-01-01',
      wordCount: 100,
      sourceType: 'html',
      extractionMethod: 'readability',
    });
  });

  it('returns 401 for unauthenticated requests', async () => {
    mockAuth.mockResolvedValue(null);
    const req = createRequest({ url: 'https://example.com' });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 400 when url is missing', async () => {
    const req = createRequest({});
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns extracted preview for valid URL', async () => {
    const req = createRequest({ url: 'https://example.com/article' });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.title).toBe('Test Article');
    expect(data.siteName).toBe('Example Site');
    expect(data.wordCount).toBe(100);
    expect(data.sourceType).toBe('html');
    expect(data.preview).toBeDefined();
  });

  it('returns 429 when rate limited', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 });
    const req = createRequest({ url: 'https://example.com' });
    const res = await POST(req);
    expect(res.status).toBe(429);
  });

  it('handles extraction failures gracefully', async () => {
    mockExtractContent.mockRejectedValue(new Error('Network timeout'));
    const req = createRequest({ url: 'https://example.com/broken' });
    const res = await POST(req);
    expect(res.status).toBe(422);

    const data = await res.json();
    expect(data.error).toContain('Failed to extract');
  });
});
