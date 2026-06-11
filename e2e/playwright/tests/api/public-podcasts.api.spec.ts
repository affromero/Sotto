import { test, expect } from '../../fixtures/auth';

test.describe('Public podcast API routes', () => {
  test('podcast detail public', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.get(`/api/v1/podcasts/${seedData.testPodcast.id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('title');
    expect(body).toHaveProperty('user');
  });

  test('podcast not found', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/v1/podcasts/nonexistent-id-xyz');
    expect(res.status()).toBe(404);
  });
});
