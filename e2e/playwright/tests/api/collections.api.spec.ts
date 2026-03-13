import { test, expect } from '../../fixtures/auth';

test.describe('Collections API routes', () => {
  test.describe.configure({ mode: 'serial' });

  let newCollectionId: string;

  test('GET collections', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/collections');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('collections');
  });

  test('POST create collection', async ({ authedRequest }) => {
    const res = await authedRequest.post('/api/collections', {
      data: { name: 'E2E New Collection', description: 'Created by API test' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    newCollectionId = body.id;
  });

  test('GET collection detail', async ({ authedRequest }) => {
    const res = await authedRequest.get(`/api/collections/${newCollectionId}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('E2E New Collection');
  });

  test('PATCH update collection', async ({ authedRequest }) => {
    const res = await authedRequest.patch(`/api/collections/${newCollectionId}`, {
      data: { name: 'E2E Updated Collection' },
    });
    expect(res.status()).toBe(200);
  });

  test('POST add item to collection', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.post(`/api/collections/${newCollectionId}/items`, {
      data: { podcastId: seedData.testPodcast.id },
    });
    expect(res.status()).toBe(201);
  });

  test('DELETE remove item from collection', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.delete(`/api/collections/${newCollectionId}/items`, {
      data: { podcastId: seedData.testPodcast.id },
    });
    expect(res.status()).toBe(200);
  });

  test('POST follow collection', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.post(`/api/collections/${seedData.collection.id}/follow`);
    expect(res.status()).toBe(200);
  });

  test('DELETE unfollow collection', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.delete(`/api/collections/${seedData.collection.id}/follow`);
    expect(res.status()).toBe(200);
  });

  test('DELETE collection', async ({ authedRequest }) => {
    const res = await authedRequest.delete(`/api/collections/${newCollectionId}`);
    expect(res.status()).toBe(200);
  });
});
