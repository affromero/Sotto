import { test, expect } from '../../fixtures/auth';

test.describe('Episode CRUD API routes', () => {
  test.describe.configure({ mode: 'serial' });

  test('list own episodes', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/v1/episodes');
    expect(res.status()).toBe(200);
  });

  test('get detail authed', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.get(`/api/v1/episodes/${seedData.testEpisode.id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.title).toBe('E2E Test Episode');
  });

  test('patch title', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.patch(`/api/v1/episodes/${seedData.testEpisode.id}`, {
      data: { title: 'E2E Test Episode Updated' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.title).toBe('E2E Test Episode Updated');

    // Restore original title
    await authedRequest.patch(`/api/v1/episodes/${seedData.testEpisode.id}`, {
      data: { title: 'E2E Test Episode' },
    });
  });

  test('patch non-owned returns 403', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.patch(`/api/v1/episodes/${seedData.otherEpisode.id}`, {
      data: { title: 'Should Not Work' },
    });
    expect(res.status()).toBe(403);
  });
});
