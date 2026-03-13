import { test, expect } from '../../fixtures/auth';

test.describe('Public user API routes', () => {
  test('public profile returns user data', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.get(`/api/users/${seedData.otherUser.id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('name');
    expect(body).toHaveProperty('handle');
  });

  test('authed profile shows isFollowing', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.get(`/api/users/${seedData.otherUser.id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('isFollowing');
  });

  test('followers list', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.get(`/api/users/${seedData.user.id}/followers`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('followers');
    expect(body).toHaveProperty('total');
  });

  test('following list', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.get(`/api/users/${seedData.otherUser.id}/following`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('following');
  });

  test('liked podcasts', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.get(`/api/users/${seedData.otherUser.id}/liked`);
    expect(res.status()).toBe(200);
  });

  test('activity feed', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.get(`/api/users/${seedData.otherUser.id}/activity`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('activities');
  });

  test('collections list', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.get(`/api/users/${seedData.otherUser.id}/collections`);
    expect(res.status()).toBe(200);
  });

  test('user search', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/users/search?handle=e2e');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test('suggested users', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/users/suggested');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('users');
  });

  test('discover users', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/users/discover?query=test');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('users');
    expect(body).toHaveProperty('total');
  });
});
