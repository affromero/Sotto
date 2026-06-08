import { test, expect } from '../../fixtures/auth';

test.describe('Private library API routes', () => {
  test('recommendations', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/recommendations?topic=Testing');
    expect(res.status()).toBe(200);
  });

  test('picks GET', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/picks');
    expect(res.status()).toBe(200);
  });

  test('picks POST refresh', async ({ authedRequest }) => {
    const res = await authedRequest.post('/api/picks');
    expect(res.status()).toBe(200);
  });

  test('saved', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/saved');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('podcasts');
  });
});
