import { getSiteConfig } from './site-config';
import { hasConfiguredAdminEmails } from './admin-emails';

/**
 * Whether the local profile sign-in is active: the Credentials provider and the
 * Netflix-style profile picker. Owner-set via SiteConfig.localAuth, where null
 * means "use the default". The default is on whenever no ADMIN_EMAILS are
 * configured, which covers both the self-hosted instance and the managed
 * showcase: the web experience is the local profile picker, not OAuth. A real
 * multi-tenant deployment opts into OAuth by configuring ADMIN_EMAILS (or by
 * setting SiteConfig.localAuth = false explicitly). An explicit true or false
 * always wins. This is an explicit setting, not an availability fallback: when it
 * returns false, Credentials must refuse to authorize and the picker must not
 * render.
 */
export async function isLocalAuthEnabled(): Promise<boolean> {
  const { localAuth } = await getSiteConfig();
  if (localAuth === true) return true;
  if (localAuth === false) return false;
  return !hasConfiguredAdminEmails();
}
