import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockPodcastFindMany,
  mockWaitlistFindMany,
  mockAssertEmailDeliveryConfigured,
  mockSendEmail,
  mockBuildWeeklyDigestEmail,
} = vi.hoisted(() => ({
  mockPodcastFindMany: vi.fn(),
  mockWaitlistFindMany: vi.fn(),
  mockAssertEmailDeliveryConfigured: vi.fn(),
  mockSendEmail: vi.fn(),
  mockBuildWeeklyDigestEmail: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prismaUnfiltered: {
    podcast: { findMany: (...args: unknown[]) => mockPodcastFindMany(...args) },
    waitlist: { findMany: (...args: unknown[]) => mockWaitlistFindMany(...args) },
  },
}));
vi.mock('@/lib/email', () => ({
  EmailDeliveryError: class EmailDeliveryError extends Error {
    readonly cause: unknown;

    constructor(message: string, cause: unknown) {
      super(message);
      this.name = 'EmailDeliveryError';
      this.cause = cause;
    }
  },
  assertEmailDeliveryConfigured: () => mockAssertEmailDeliveryConfigured(),
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));
vi.mock('@/lib/email-templates', () => ({
  buildWeeklyDigestEmail: (...args: unknown[]) => mockBuildWeeklyDigestEmail(...args),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { processEmailDigest } from '@/workers/email-digest.worker';

function makeJob(): Job {
  return { updateProgress: vi.fn() } as unknown as Job;
}

function mockPodcast() {
  return {
    id: 'podcast-1',
    title: 'Private Briefing',
    topic: 'AI infrastructure',
    slug: 'private-briefing',
    user: { name: 'Ada', handle: 'ada' },
  };
}

describe('processEmailDigest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPodcastFindMany.mockResolvedValue([mockPodcast()]);
    mockWaitlistFindMany.mockResolvedValue([
      { email: 'one@example.com' },
      { email: 'two@example.com' },
    ]);
    mockAssertEmailDeliveryConfigured.mockReturnValue(undefined);
    mockSendEmail.mockResolvedValue(undefined);
    mockBuildWeeklyDigestEmail.mockImplementation((email: string) => ({
      subject: 'Weekly digest',
      html: `<p>${email}</p>`,
    }));
  });

  it('sends weekly digest emails when delivery is configured', async () => {
    const result = await processEmailDigest(makeJob());

    expect(result).toEqual({ sent: 2, failed: 0, total: 2 });
    expect(mockAssertEmailDeliveryConfigured).toHaveBeenCalledOnce();
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
  });

  it('fails the job when email delivery is not configured', async () => {
    mockAssertEmailDeliveryConfigured.mockImplementation(() => {
      throw new Error('RESEND_API_KEY and EMAIL_FROM are required');
    });

    await expect(processEmailDigest(makeJob())).rejects.toThrow(/RESEND_API_KEY/);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('fails the job when any digest email cannot be delivered', async () => {
    mockSendEmail.mockImplementation((options: { to: string }) => {
      if (options.to === 'two@example.com') {
        return Promise.reject(new Error('resend unavailable'));
      }
      return Promise.resolve();
    });

    await expect(processEmailDigest(makeJob())).rejects.toThrow(
      /Weekly email digest failed for 1 recipient/
    );
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
  });
});
