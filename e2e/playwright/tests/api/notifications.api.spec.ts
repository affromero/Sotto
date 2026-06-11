import { test, expect } from '../../fixtures/auth';

test.describe('Notifications API routes', () => {
  test('GET notifications', async ({ authedRequest }) => {
    const res = await authedRequest.get('/api/v1/notifications');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('notifications');
    expect(body).toHaveProperty('unreadCount');
  });

  test('PATCH mark notification read', async ({ authedRequest, seedData }) => {
    const notifId = seedData.notifications[0].id;
    const res = await authedRequest.patch(`/api/v1/notifications/${notifId}`, {
      data: { read: true },
    });
    expect(res.status()).toBe(200);
  });

  test('POST mark all read', async ({ authedRequest }) => {
    const res = await authedRequest.post('/api/v1/notifications/mark-all-read');
    expect(res.status()).toBe(200);
  });
});
