import { test, expect } from '../../fixtures/auth';

test.describe('Misc API routes', () => {
  test('health returns status', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('status');
  });

  test('tags returns array', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/tags');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]).toHaveProperty('name');
    expect(body[0]).toHaveProperty('slug');
  });

  test('handles/check available', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/handles/check?handle=zzz-nonexistent-handle-999');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(true);
  });

  test('handles/check taken', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/handles/check?handle=e2e-test');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(false);
  });

  test('handles/check missing param', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/handles/check');
    expect(res.status()).toBe(400);
  });

  test('feedback creates entry', async ({ authedRequest }) => {
    const res = await authedRequest.post('/api/feedback', {
      data: { type: 'GENERAL', subject: 'E2E test feedback', message: 'This is a test feedback entry' },
    });
    expect(res.status()).toBe(201);
  });

  test('feedback rejects invalid', async ({ authedRequest }) => {
    const res = await authedRequest.post('/api/feedback', {
      data: { invalid: true },
    });
    expect(res.status()).toBe(400);
  });

  test('access returns gated status', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/access');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('gated');
  });

  test('invite/redeem valid code', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.post('/api/invite/redeem', {
      data: { code: seedData.freshInviteCode, email: 'invite-test@example.com' },
    });
    expect(res.status()).toBe(200);
  });

  test('invite/redeem invalid code', async ({ authedRequest }) => {
    const res = await authedRequest.post('/api/invite/redeem', {
      data: { code: 'nonexistent-code-xyz', email: 'test@example.com' },
    });
    expect([400, 404]).toContain(res.status());
  });
});
