import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PracticeIncompleteError } from '@/lib/practice/types';

const submit = vi.fn();
vi.mock('@/lib/api-keys', () => ({ authenticateRequest: async () => ({ userId: 'user' }) }));
vi.mock('@/lib/practice-service', () => ({
  submitPractice: (...args: unknown[]) => submit(...args),
  PracticeSessionNotFoundError: class extends Error {},
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
import { POST } from '@/app/api/v1/practice/[sessionId]/submit/route';

beforeEach(() => {
  submit.mockReset();
});

it('returns an actionable conflict when listening or speaking is incomplete', async () => {
  submit.mockRejectedValue(
    new PracticeIncompleteError('Record every speaking exercise before finishing.')
  );
  const response = await POST(
    new NextRequest('http://localhost/api/v1/practice/session/submit', {
      method: 'POST',
      body: JSON.stringify({ answers: [] }),
    }),
    { params: Promise.resolve({ sessionId: 'session' }) }
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: expect.stringMatching(/speaking/i) });
});
