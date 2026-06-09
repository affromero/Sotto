/**
 * isLocalAuthEnabled: the explicit gate for the local profile sign-in. Owner-set
 * SiteConfig.localAuth wins (true or false); null uses the default, on for a
 * self-hosted instance with no ADMIN_EMAILS, off otherwise. Not an availability
 * fallback: an explicit false disables it even on self-hosted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSiteConfig = vi.fn();
const mockIsSelfHosted = vi.fn();
const mockHasAdminEmails = vi.fn();

vi.mock('@/lib/site-config', () => ({
  getSiteConfig: (...a: unknown[]) => mockGetSiteConfig(...a),
}));
vi.mock('@/lib/self-hosted', () => ({
  isSelfHosted: (...a: unknown[]) => mockIsSelfHosted(...a),
}));
vi.mock('@/lib/admin-emails', () => ({
  hasConfiguredAdminEmails: (...a: unknown[]) => mockHasAdminEmails(...a),
}));

import { isLocalAuthEnabled } from '@/lib/local-auth';

describe('isLocalAuthEnabled', () => {
  beforeEach(() => vi.clearAllMocks());

  it('explicit true wins', async () => {
    mockGetSiteConfig.mockResolvedValue({ localAuth: true });
    expect(await isLocalAuthEnabled()).toBe(true);
  });

  it('explicit false wins even on a self-hosted instance', async () => {
    mockGetSiteConfig.mockResolvedValue({ localAuth: false });
    mockIsSelfHosted.mockReturnValue(true);
    mockHasAdminEmails.mockReturnValue(false);
    expect(await isLocalAuthEnabled()).toBe(false);
  });

  it('defaults on for self-hosted with no admin emails', async () => {
    mockGetSiteConfig.mockResolvedValue({ localAuth: null });
    mockIsSelfHosted.mockReturnValue(true);
    mockHasAdminEmails.mockReturnValue(false);
    expect(await isLocalAuthEnabled()).toBe(true);
  });

  it('defaults off for the managed case (not self-hosted)', async () => {
    mockGetSiteConfig.mockResolvedValue({ localAuth: null });
    mockIsSelfHosted.mockReturnValue(false);
    mockHasAdminEmails.mockReturnValue(false);
    expect(await isLocalAuthEnabled()).toBe(false);
  });

  it('defaults off when admin emails are configured', async () => {
    mockGetSiteConfig.mockResolvedValue({ localAuth: null });
    mockIsSelfHosted.mockReturnValue(true);
    mockHasAdminEmails.mockReturnValue(true);
    expect(await isLocalAuthEnabled()).toBe(false);
  });
});
