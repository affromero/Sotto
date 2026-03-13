import { test, expect } from '../../fixtures/auth';

test.describe('Drafts API routes', () => {
  test.describe.configure({ mode: 'serial' });

  let draftId: string;

  test('POST create draft', async ({ authedRequest }) => {
    const res = await authedRequest.post('/api/drafts', {
      data: { tabMode: 'create', metadata: { topic: 'E2E API Draft topic' } },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    draftId = body.id;
  });

  test('GET draft', async ({ authedRequest }) => {
    const res = await authedRequest.get(`/api/drafts/${draftId}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('title');
  });

  test('PATCH draft', async ({ authedRequest }) => {
    const res = await authedRequest.patch(`/api/drafts/${draftId}`, {
      data: { metadata: { topic: 'Updated draft topic' } },
    });
    expect(res.status()).toBe(200);
  });

  test('DELETE draft', async ({ authedRequest }) => {
    const res = await authedRequest.delete(`/api/drafts/${draftId}`);
    expect(res.status()).toBe(200);
  });

  test('GET nonexistent draft returns 404', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/drafts/nonexistent-draft-id');
    expect(res.status()).toBe(404);
  });
});
