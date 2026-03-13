import { test, expect } from '../../fixtures/auth';

test.describe('Podcast advanced API routes', () => {
  test('export POST triggers PDF', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.post(`/api/podcasts/${seedData.testPodcast.id}/export`);
    expect(res.status()).toBe(200);
  });

  test('export GET status', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.get(`/api/podcasts/${seedData.testPodcast.id}/export`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('status');
  });

  test('voice-tracks GET', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.get(`/api/podcasts/${seedData.testPodcast.id}/voice-tracks`);
    expect(res.status()).toBe(200);
  });

  test('default-track PATCH null', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.patch(`/api/podcasts/${seedData.testPodcast.id}/default-track`, {
      data: { voiceTrackId: null },
    });
    expect(res.status()).toBe(200);
  });

  test('default-track PATCH valid', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.patch(`/api/podcasts/${seedData.testPodcast.id}/default-track`, {
      data: { voiceTrackId: seedData.voiceTrack.id },
    });
    expect(res.status()).toBe(200);
  });

  test('claims POST', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.post(`/api/podcasts/${seedData.testPodcast.id}/claims`, {
      data: {
        turnIndex: 0,
        turnText: 'Test claim text',
        description: 'This claim needs verification',
      },
    });
    expect(res.status()).toBe(201);
  });

  test('claims GET', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.get(`/api/podcasts/${seedData.testPodcast.id}/claims`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('items');
  });

  test('copyright-claim POST', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.post(`/api/podcasts/${seedData.testPodcast.id}/copyright-claim`, {
      data: {
        description: 'Copyright infringement on my content',
        claimantEmail: 'test@example.com',
        claimantName: 'Test Claimant',
      },
    });
    expect(res.status()).toBe(201);
  });

  test('video GET', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.get(`/api/podcasts/${seedData.testPodcast.id}/video`);
    expect(res.status()).toBe(200);
  });

  test('generate on READY podcast returns error', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.post(`/api/podcasts/${seedData.testPodcast.id}/generate`);
    // 400 (wrong status) or 403 (no voice provider for free user)
    expect([400, 403]).toContain(res.status());
  });

  test('import without file returns 400', async ({ authedRequest }) => {
    const res = await authedRequest.post('/api/podcasts/import', {
      data: {},
    });
    expect(res.status()).toBe(400);
  });
});
