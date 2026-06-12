import { test, expect } from '../../fixtures/auth';

test.describe('Users /me API routes', () => {
  test('GET me returns profile', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/v1/users/me');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('email');
    expect(body).toHaveProperty('handle');
  });

  test('PATCH me updates bio', async ({ authedRequest }) => {
    const res = await authedRequest.patch('/api/v1/users/me', {
      data: { bio: 'Updated bio from E2E test' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.bio).toBe('Updated bio from E2E test');
  });

  test('PATCH me rejects invalid handle', async ({ authedRequest }) => {
    const res = await authedRequest.patch('/api/v1/users/me', {
      data: { handle: 'e2e-other' },
    });
    expect([400, 409]).toContain(res.status());
  });

  test('GET me/episodes returns list', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/v1/users/me/episodes');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('episodes');
  });

  test('GET me/export returns data', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/v1/users/me/export');
    expect(res.status()).toBe(200);
    const contentDisposition = res.headers()['content-disposition'];
    expect(contentDisposition).toBeTruthy();
  });
});
