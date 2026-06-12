import { test, expect } from '../../fixtures/auth';

test.describe('Private library API routes', () => {
  test('saved', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/v1/saved');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('episodes');
  });
});
