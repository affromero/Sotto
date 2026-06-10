/**
 * POST /api/live-translate/token — auth + Zod + ownership, then mints an ephemeral
 * Gemini Live token. Adversarial: 401 unauth, 400 bad body, 404 non-owner course,
 * 422 when the key is missing or lacks Live access, 500 on the unexpected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticate = vi.fn();
const mockMintLiveToken = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...a: unknown[]) => mockAuthenticate(...a),
}));
vi.mock('@/lib/live-translate', async () => {
  const actual = await vi.importActual<typeof import('@/lib/live-translate')>('@/lib/live-translate');
  return { ...actual, mintLiveToken: (...a: unknown[]) => mockMintLiveToken(...a) };
});
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { POST } from '@/app/api/live-translate/token/route';
import {
  LiveTranslateKeyError,
  LiveTranslateCourseError,
  LiveTranslateAccessError,
} from '@/lib/live-translate';

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/live-translate/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID = { courseId: 'c1', direction: 'native_to_target' };
const TOKEN = {
  token: 'ephemeral-token-xyz',
  model: 'gemini-live-2.5-flash-preview',
  apiVersion: 'v1alpha',
  targetLanguageCode: 'de',
  nativeLanguageCode: 'en',
  direction: 'native_to_target',
  expiresAt: '2026-06-09T00:30:00.000Z',
};

describe('POST /api/live-translate/token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ userId: 'u1' });
    mockMintLiveToken.mockResolvedValue(TOKEN);
  });

  it('rejects an unauthenticated request', async () => {
    mockAuthenticate.mockResolvedValue(null);
    const res = await POST(req(VALID));
    expect(res.status).toBe(401);
    expect(mockMintLiveToken).not.toHaveBeenCalled();
  });

  it('rejects an invalid direction', async () => {
    const res = await POST(req({ courseId: 'c1', direction: 'sideways' }));
    expect(res.status).toBe(400);
    expect(mockMintLiveToken).not.toHaveBeenCalled();
  });

  it('mints a token for an owned course', async () => {
    const res = await POST(req(VALID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(TOKEN);
    expect(mockMintLiveToken).toHaveBeenCalledWith('u1', 'c1', 'native_to_target');
  });

  it('returns 404 for a course the caller does not own', async () => {
    mockMintLiveToken.mockRejectedValue(new LiveTranslateCourseError('Course not found'));
    const res = await POST(req(VALID));
    expect(res.status).toBe(404);
  });

  it('returns 422 with guidance when the learner has no Google key', async () => {
    mockMintLiveToken.mockRejectedValue(new LiveTranslateKeyError('add a Google key'));
    const res = await POST(req(VALID));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain('Google key');
  });

  it('returns 422 when the key lacks Live access', async () => {
    mockMintLiveToken.mockRejectedValue(new LiveTranslateAccessError('no access'));
    const res = await POST(req(VALID));
    expect(res.status).toBe(422);
  });

  it('returns 500 on an unexpected failure', async () => {
    mockMintLiveToken.mockRejectedValue(new Error('boom'));
    const res = await POST(req(VALID));
    expect(res.status).toBe(500);
  });
});
