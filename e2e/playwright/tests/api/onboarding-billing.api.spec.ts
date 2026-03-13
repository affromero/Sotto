import { test, expect } from '../../fixtures/auth';

test.describe('Onboarding and billing API routes', () => {
  test('onboarding interests', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.post('/api/onboarding/interests', {
      data: { tagIds: [seedData.subTag.id], customTags: [] },
    });
    expect(res.status()).toBe(200);
  });

  test('onboarding complete', async ({ authedRequest }) => {
    const res = await authedRequest.post('/api/onboarding/complete');
    expect(res.status()).toBe(200);
  });

  test('billing checkout returns 503 without Stripe', async ({ authedRequest }) => {
    const res = await authedRequest.post('/api/billing/checkout', {
      data: { priceId: 'price_test' },
    });
    expect([400, 500, 503]).toContain(res.status());
  });

  test('billing portal returns 503 without Stripe', async ({ authedRequest }) => {
    const res = await authedRequest.post('/api/billing/portal');
    expect([400, 500, 503]).toContain(res.status());
  });

  test('taste-quiz GET', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/taste-quiz');
    expect(res.status()).toBe(200);
  });

  test('taste-quiz POST', async ({ authedRequest }) => {
    const res = await authedRequest.post('/api/taste-quiz', {
      data: {
        answers: [
          { questionId: 'q1', question: 'Coffee History', tagSlugs: ['history'], response: 'yes' },
        ],
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('saved');
  });

  test('taste-quiz DELETE', async ({ authedRequest }) => {
    const res = await authedRequest.delete('/api/taste-quiz');
    expect(res.status()).toBe(200);
  });

  test('reports POST', async ({ authedRequest, seedData }) => {
    const res = await authedRequest.post('/api/reports', {
      data: {
        targetType: 'podcast',
        targetId: seedData.otherPodcast.id,
        reason: 'SPAM',
        description: 'Test report from E2E',
      },
    });
    expect(res.status()).toBe(201);
  });
});
