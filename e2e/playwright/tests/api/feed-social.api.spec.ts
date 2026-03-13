import { test, expect } from '../../fixtures/auth';

test.describe('Feed and social API routes', () => {
  test('feed default', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/feed');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('podcasts');
  });

  test('feed trending', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/feed?mode=trending');
    expect(res.status()).toBe(200);
  });

  test('feed explore', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/feed?mode=explore');
    expect(res.status()).toBe(200);
  });

  test('feed following', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/feed?mode=following');
    expect(res.status()).toBe(200);
  });

  test('feed remixes', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/feed?mode=remixes');
    expect(res.status()).toBe(200);
  });

  test('activity', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/activity');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('activities');
  });

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
