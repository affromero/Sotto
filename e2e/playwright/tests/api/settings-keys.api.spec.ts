import { test, expect } from '../../fixtures/auth';

test.describe('Settings, keys, voices, models API routes', () => {
  test.describe.configure({ mode: 'serial' });

  let createdKeyId: string;

  test('GET keys', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/keys');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test('POST create key', async ({ authedRequest }) => {
    const res = await authedRequest.post('/api/keys', {
      data: { name: 'E2E Test Key' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty('key');
    expect(body).toHaveProperty('id');
    createdKeyId = body.id;
  });

  test('DELETE revoke key', async ({ authedRequest }) => {
    const res = await authedRequest.delete(`/api/keys/${createdKeyId}`);
    expect([200, 204]).toContain(res.status());
  });

  test('GET BYOK keys', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/settings/byok');
    expect(res.status()).toBe(200);
  });

  test('GET AI keys', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/settings/ai-keys');
    expect(res.status()).toBe(200);
  });

  test('GET ai-models', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/ai-models');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('models');
  });

  test('GET tts-options', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/tts-options');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('options');
  });

  test('GET voices', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/voices');
    expect(res.status()).toBe(200);
  });

  test('GET voices/browse', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/voices/browse');
    expect(res.status()).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('Voice marketplace is currently unavailable.');
  });
});
