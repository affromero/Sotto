import { getSiteConfig } from './site-config';
import { hasConfiguredAdminEmails } from './admin-emails';
import { isSelfHosted } from './self-hosted';

/**
 * Whether the local profile sign-in is active: the Credentials provider and the
 * Netflix-style profile picker. Owner-set via SiteConfig.localAuth, where null
 * means "use the default". The managed showcase (`SELF_HOSTED=false`) never
 * shows local profiles; visitors go straight through the public welcome demo.
 * Self-hosted defaults to local auth when no ADMIN_EMAILS are configured. A real
 * OAuth multi-tenant deployment opts out by configuring ADMIN_EMAILS or setting
 * SiteConfig.localAuth = false explicitly. This is an explicit setting, not an
 * availability fallback: when it returns false, Credentials must refuse to
 * authorize and the picker must not render.
 */
export async function isLocalAuthEnabled(): Promise<boolean> {
  if (!isSelfHosted()) return false;

  const { localAuth } = await getSiteConfig();
  if (localAuth === true) return true;
  if (localAuth === false) return false;
  return !hasConfiguredAdminEmails();
}
