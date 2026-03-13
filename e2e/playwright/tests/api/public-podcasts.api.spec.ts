import { test, expect } from '../../fixtures/auth';

test.describe('Public podcast API routes', () => {
  test('podcast detail public', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.get(`/api/podcasts/${seedData.testPodcast.id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('title');
    expect(body).toHaveProperty('user');
  });

  test('podcast not found', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/podcasts/nonexistent-id-xyz');
    expect(res.status()).toBe(404);
  });

  test('lineage returns data', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.get(`/api/podcasts/${seedData.testPodcast.id}/lineage`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('ancestors');
    expect(body).toHaveProperty('forks');
  });

  test('quality returns score', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.get(`/api/podcasts/${seedData.testPodcast.id}/quality`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('qualityScore');
  });

  test('questions returns public Q&A', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.get(`/api/podcasts/${seedData.testPodcast.id}/questions`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('items');
  });

  test('comments returns list', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.get(`/api/podcasts/${seedData.testPodcast.id}/comments`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('items');
    expect(body).toHaveProperty('total');
  });
});
