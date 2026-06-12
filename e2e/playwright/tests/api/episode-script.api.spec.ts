import { test, expect } from '../../fixtures/auth';
import { test as unauthTest, expect as unauthExpect } from '@playwright/test';

test.describe('Episode script API routes', () => {
  test.describe.configure({ mode: 'serial' });

  test('get script', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.get(`/api/v1/episodes/${seedData.scriptReadyEpisode.id}/script`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('turns');
    expect(body).toHaveProperty('version');
  });

  test('patch script turns', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.patch(`/api/v1/episodes/${seedData.scriptReadyEpisode.id}/script`, {
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
    const res = await authedRequest.post(`/api/v1/episodes/${seedData.scriptReadyEpisode.id}/script/approve`);
    expect(res.status()).toBe(200);
  });

  test('verification-details', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.get(`/api/v1/episodes/${seedData.testEpisode.id}/verification-details`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('summary');
  });

  test('knowledge-gaps', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.get(`/api/v1/episodes/${seedData.testEpisode.id}/knowledge-gaps`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('segments');
  });
});

unauthTest.describe('Episode script auth guard', () => {
  unauthTest('get script unauthed returns 401', async ({ request }) => {
    const res = await request.get('/api/v1/episodes/e2e-episode/script');
    unauthExpect(res.status()).toBe(401);
  });
});
