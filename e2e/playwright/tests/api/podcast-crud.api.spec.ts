import { test, expect } from '../../fixtures/auth';

test.describe('Podcast CRUD API routes', () => {
  test.describe.configure({ mode: 'serial' });

  test('list own podcasts', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/v1/podcasts');
    expect(res.status()).toBe(200);
  });

  test('get detail authed', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.get(`/api/v1/podcasts/${seedData.testPodcast.id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.title).toBe('E2E Test Podcast');
  });

  test('patch title', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.patch(`/api/v1/podcasts/${seedData.testPodcast.id}`, {
      data: { title: 'E2E Test Podcast Updated' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.title).toBe('E2E Test Podcast Updated');

    // Restore original title
    await authedRequest.patch(`/api/v1/podcasts/${seedData.testPodcast.id}`, {
      data: { title: 'E2E Test Podcast' },
    });
  });

  test('patch non-owned returns 403', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.patch(`/api/v1/podcasts/${seedData.otherPodcast.id}`, {
      data: { title: 'Should Not Work' },
    });
    expect(res.status()).toBe(403);
  });
});
