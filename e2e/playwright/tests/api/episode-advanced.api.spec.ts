import { test, expect } from '../../fixtures/auth';

test.describe('Episode advanced API routes', () => {
  test('export POST triggers PDF', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.post(`/api/v1/episodes/${seedData.testEpisode.id}/export`);
    expect(res.status()).toBe(200);
  });

  test('export GET status', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.get(`/api/v1/episodes/${seedData.testEpisode.id}/export`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('status');
  });

  test('video GET', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.get(`/api/v1/episodes/${seedData.testEpisode.id}/video`);
    expect(res.status()).toBe(200);
  });

  test('generate on READY episode returns error', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.post(`/api/v1/episodes/${seedData.testEpisode.id}/generate`);
    // A READY episode cannot be regenerated.
    expect([400, 403]).toContain(res.status());
  });
});
