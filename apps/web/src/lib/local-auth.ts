import { getSiteConfig } from './site-config';
import { isSelfHosted } from './self-hosted';
import { hasConfiguredAdminEmails } from './admin-emails';

/**
 * Whether the local profile sign-in is active: the Credentials provider and the
 * Netflix-style profile picker. Owner-set via SiteConfig.localAuth, where null
 * means "use the default". The default is on for a self-hosted instance with no
 * ADMIN_EMAILS configured (the typical self-host), and off for the managed case.
 * An explicit true or false always wins. This is an explicit setting, not an
 * availability fallback: when it returns false, Credentials must refuse to
 * authorize and the picker must not render.
 */
export async function isLocalAuthEnabled(): Promise<boolean> {
  const { localAuth } = await getSiteConfig();
  if (localAuth === true) return true;
  if (localAuth === false) return false;
  return isSelfHosted() && !hasConfiguredAdminEmails();
}
