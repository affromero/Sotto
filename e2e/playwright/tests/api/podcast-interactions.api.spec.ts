import { test, expect } from '../../fixtures/auth';

test.describe('Podcast interactions API routes', () => {
  test.describe.configure({ mode: 'serial' });

  test('create interaction', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.post(`/api/podcasts/${seedData.testPodcast.id}/interact`, {
      data: {
        question: 'What are the benefits of automated testing?',
        timestamp: 60.0,
      },
    });
    expect(res.status()).toBe(201);
  });

  test('incorporate returns 202 or 403', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.post(
      `/api/podcasts/${seedData.testPodcast.id}/interact/${seedData.interaction.id}/incorporate`
    );
    // 202 if generation gate passes, 403 if no TTS provider configured
    expect([200, 202, 403]).toContain(res.status());
  });
});
