import { test, expect } from '../../fixtures/auth';

test.describe('Public episode API routes', () => {
  test('episode detail public', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.get(`/api/v1/episodes/${seedData.testEpisode.id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('title');
    expect(body).toHaveProperty('user');
  });

  test('episode not found', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/v1/episodes/nonexistent-id-xyz');
    expect(res.status()).toBe(404);
  });
});
