/**
 * isLocalAuthEnabled: the explicit gate for the local profile sign-in. Owner-set
 * SiteConfig.localAuth wins (true or false); null uses the default, which is on
 * whenever no ADMIN_EMAILS are configured (self-hosted and the managed showcase
 * alike, so the web auth is the local profile picker, not OAuth) and off when
 * ADMIN_EMAILS are set. Not an availability fallback: an explicit false disables
 * it even with no admin emails.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSiteConfig = vi.fn();
const mockHasAdminEmails = vi.fn();

vi.mock('@/lib/site-config', () => ({
  getSiteConfig: (...a: unknown[]) => mockGetSiteConfig(...a),
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

  it('explicit false wins even with no admin emails', async () => {
    mockGetSiteConfig.mockResolvedValue({ localAuth: false });
    mockHasAdminEmails.mockReturnValue(false);
    expect(await isLocalAuthEnabled()).toBe(false);
  });

  it('defaults on with no admin emails (self-hosted and managed showcase alike)', async () => {
    mockGetSiteConfig.mockResolvedValue({ localAuth: null });
    mockHasAdminEmails.mockReturnValue(false);
    expect(await isLocalAuthEnabled()).toBe(true);
  });

  it('defaults off when admin emails are configured (real OAuth multi-tenant)', async () => {
    mockGetSiteConfig.mockResolvedValue({ localAuth: null });
    mockHasAdminEmails.mockReturnValue(true);
    expect(await isLocalAuthEnabled()).toBe(false);
  });
});
