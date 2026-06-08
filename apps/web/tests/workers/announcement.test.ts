import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockUserCount,
  mockUserFindMany,
  mockNotificationCreate,
  mockSendPushNotification,
  mockSendExpoPushNotification,
  mockSendEmail,
  mockBuildAnnouncementEmail,
  mockGenerateUserUnsubscribeUrl,
} = vi.hoisted(() => ({
  mockUserCount: vi.fn(),
  mockUserFindMany: vi.fn(),
  mockNotificationCreate: vi.fn(),
  mockSendPushNotification: vi.fn(),
  mockSendExpoPushNotification: vi.fn(),
  mockSendEmail: vi.fn(),
  mockBuildAnnouncementEmail: vi.fn(),
  mockGenerateUserUnsubscribeUrl: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prismaUnfiltered: {
    user: {
      count: (...args: unknown[]) => mockUserCount(...args),
      findMany: (...args: unknown[]) => mockUserFindMany(...args),
    },
    notification: {
      create: (...args: unknown[]) => mockNotificationCreate(...args),
    },
  },
}));
vi.mock('@/lib/push-notifications', () => ({
  sendPushNotification: (...args: unknown[]) => mockSendPushNotification(...args),
  sendExpoPushNotification: (...args: unknown[]) => mockSendExpoPushNotification(...args),
}));
vi.mock('@/lib/email', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));
vi.mock('@/lib/email-templates', () => ({
  buildAnnouncementEmail: (...args: unknown[]) => mockBuildAnnouncementEmail(...args),
  generateUserUnsubscribeUrl: (...args: unknown[]) => mockGenerateUserUnsubscribeUrl(...args),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { processAnnouncement } from '@/workers/announcement.worker';

function makeJob() {
  return {
    data: { subject: 'Product update', message: 'Private briefings are live.' },
    updateProgress: vi.fn(),
  } as never;
}

describe('processAnnouncement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserCount.mockResolvedValue(1);
    mockUserFindMany.mockResolvedValue([
      {
        id: 'user-1',
        email: 'user@example.com',
        pushNotifications: false,
        emailNotifications: true,
      },
    ]);
    mockNotificationCreate.mockResolvedValue({ id: 'notification-1' });
    mockSendPushNotification.mockResolvedValue(undefined);
    mockSendExpoPushNotification.mockResolvedValue(undefined);
    mockSendEmail.mockResolvedValue(undefined);
    mockGenerateUserUnsubscribeUrl.mockReturnValue('https://example.com/unsubscribe');
    mockBuildAnnouncementEmail.mockReturnValue({
      subject: 'Product update',
      html: '<p>Private briefings are live.</p>',
    });
  });

  it('sends announcement notifications and emails', async () => {
    await processAnnouncement(makeJob());

    expect(mockNotificationCreate).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        type: 'PLATFORM_ANNOUNCEMENT',
        title: 'Product update',
        message: 'Private briefings are live.',
      },
    });
    expect(mockSendEmail).toHaveBeenCalledWith({
      to: 'user@example.com',
      subject: 'Product update',
      html: '<p>Private briefings are live.</p>',
    });
  });

  it('fails the job when an announcement email cannot be delivered', async () => {
    mockSendEmail.mockRejectedValue(new Error('resend unavailable'));

    await expect(processAnnouncement(makeJob())).rejects.toThrow(
      /Platform announcement failed for 1 recipient/
    );
    expect(mockNotificationCreate).toHaveBeenCalled();
    expect(mockSendEmail).toHaveBeenCalled();
  });
});
