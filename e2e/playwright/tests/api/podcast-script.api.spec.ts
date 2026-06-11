import { test, expect } from '../../fixtures/auth';
import { test as unauthTest, expect as unauthExpect } from '@playwright/test';

test.describe('Podcast script API routes', () => {
  test.describe.configure({ mode: 'serial' });

  test('get script', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.get(`/api/v1/podcasts/${seedData.scriptReadyPodcast.id}/script`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('turns');
    expect(body).toHaveProperty('version');
  });

  test('patch script turns', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.patch(`/api/v1/podcasts/${seedData.scriptReadyPodcast.id}/script`, {
      data: {
        turns: [
          { speaker: 'HOST', text: 'Updated script turn from E2E test.' },
          { speaker: 'EXPERT', text: 'This has been modified.' },
        ],
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('turns');
  });

  test('approve script', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.post(`/api/v1/podcasts/${seedData.scriptReadyPodcast.id}/script/approve`);
    expect(res.status()).toBe(200);
  });

  test('verification-details', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.get(`/api/v1/podcasts/${seedData.testPodcast.id}/verification-details`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('summary');
  });

  test('knowledge-gaps', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.get(`/api/v1/podcasts/${seedData.testPodcast.id}/knowledge-gaps`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('segments');
  });
});

unauthTest.describe('Podcast script auth guard', () => {
  unauthTest('get script unauthed returns 401', async ({ request }) => {
    const res = await request.get('/api/v1/podcasts/e2e-podcast/script');
    unauthExpect(res.status()).toBe(401);
  });
});
