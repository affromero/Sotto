import { test, expect } from '../../fixtures/auth';

test.describe('Podcast social API routes', () => {
  test.describe.configure({ mode: 'serial' });

  test('like podcast', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.post(`/api/podcasts/${seedData.testPodcast.id}/like`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.liked).toBe(true);
  });

  test('like idempotent', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.post(`/api/podcasts/${seedData.testPodcast.id}/like`);
    expect(res.status()).toBe(200);
  });

  test('unlike podcast', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.delete(`/api/podcasts/${seedData.testPodcast.id}/like`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.liked).toBe(false);
  });

  test('save podcast', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.post(`/api/podcasts/${seedData.testPodcast.id}/save`);
    expect(res.status()).toBe(200);
  });

  test('unsave podcast', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.delete(`/api/podcasts/${seedData.testPodcast.id}/save`);
    expect(res.status()).toBe(200);
  });

  test('get rating null initially', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.get(`/api/podcasts/${seedData.testPodcast.id}/rating`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.rating).toBeNull();
  });

  test('post rating', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.post(`/api/podcasts/${seedData.testPodcast.id}/rating`, {
      data: {
        voiceNaturalness: 4,
        contentAccuracy: 5,
        conversationFlow: 4,
        overallSatisfaction: 4,
      },
    });
    expect(res.status()).toBe(200);
  });

  test('get comments', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.get(`/api/podcasts/${seedData.testPodcast.id}/comments`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('items');
  });

  test('post comment', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.post(`/api/podcasts/${seedData.testPodcast.id}/comments`, {
      data: { content: 'E2E test comment' },
    });
    expect(res.status()).toBe(201);
  });

  test('post reply to comment', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.post(`/api/podcasts/${seedData.testPodcast.id}/comments`, {
      data: { content: 'E2E test reply', parentId: seedData.comment.id },
    });
    expect(res.status()).toBe(201);
  });
});
