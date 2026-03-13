import { test, expect } from '../../fixtures/auth';

test.describe('Ideas API routes', () => {
  test.describe.configure({ mode: 'serial' });

  let savedIdeaId: string;

  test('GET ideas returns seeded items', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/ideas');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('ideas');
    expect(body.ideas.length).toBeGreaterThanOrEqual(2);
  });

  test('POST save idea', async ({ authedRequest }) => {
    const res = await authedRequest.post('/api/ideas', {
      data: {
        questionId: 'q-e2e-api',
        question: 'How does E2E testing work?',
        category: 'Technology',
        tagSlugs: ['technology'],
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.idea).toHaveProperty('id');
    savedIdeaId = body.idea.id;
  });

  test('DELETE idea', async ({ authedRequest }) => {
    const res = await authedRequest.delete(`/api/ideas/${savedIdeaId}`);
    expect(res.status()).toBe(200);
  });
});
