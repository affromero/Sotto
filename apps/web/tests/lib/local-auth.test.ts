/**
 * isLocalAuthEnabled: the explicit gate for the local profile sign-in. Owner-set
 * SiteConfig.localAuth wins (true or false) only on self-hosted instances;
 * SELF_HOSTED=false forces it off so the public showcase has no profiles. null
 * uses the self-hosted default, which is on whenever no ADMIN_EMAILS are
 * configured and off when ADMIN_EMAILS are set. Not an availability fallback: an
 * explicit false disables it even with no admin emails.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSiteConfig = vi.fn();
const mockHasAdminEmails = vi.fn();
const mockIsSelfHosted = vi.fn();

vi.mock('@/lib/site-config', () => ({
  getSiteConfig: (...a: unknown[]) => mockGetSiteConfig(...a),
}));
vi.mock('@/lib/admin-emails', () => ({
  hasConfiguredAdminEmails: (...a: unknown[]) => mockHasAdminEmails(...a),
}));
vi.mock('@/lib/self-hosted', () => ({
  isSelfHosted: (...a: unknown[]) => mockIsSelfHosted(...a),
}));

import { isLocalAuthEnabled } from '@/lib/local-auth';

describe('isLocalAuthEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsSelfHosted.mockReturnValue(true);
  });

  it('explicit true wins', async () => {
    mockGetSiteConfig.mockResolvedValue({ localAuth: true });
    expect(await isLocalAuthEnabled()).toBe(true);
  });

  it('explicit false wins even with no admin emails', async () => {
    mockGetSiteConfig.mockResolvedValue({ localAuth: false });
    mockHasAdminEmails.mockReturnValue(false);
    expect(await isLocalAuthEnabled()).toBe(false);
  });

  it('defaults on for self-hosted instances with no admin emails', async () => {
    mockGetSiteConfig.mockResolvedValue({ localAuth: null });
    mockHasAdminEmails.mockReturnValue(false);
    expect(await isLocalAuthEnabled()).toBe(true);
  });

  it('defaults off when admin emails are configured (real OAuth multi-tenant)', async () => {
    mockGetSiteConfig.mockResolvedValue({ localAuth: null });
    mockHasAdminEmails.mockReturnValue(true);
    expect(await isLocalAuthEnabled()).toBe(false);
  });

  it('forces local auth off on the managed showcase', async () => {
    mockIsSelfHosted.mockReturnValue(false);
    mockGetSiteConfig.mockResolvedValue({ localAuth: true });
    mockHasAdminEmails.mockReturnValue(false);

    expect(await isLocalAuthEnabled()).toBe(false);
    expect(mockGetSiteConfig).not.toHaveBeenCalled();
  });
});
