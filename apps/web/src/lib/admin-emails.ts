const adminEmails: string[] = (process.env.ADMIN_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function isAdminEmail(email: string): boolean {
  return adminEmails.includes(email.toLowerCase());
}

/**
 * Whether an explicit admin allowlist is configured (ADMIN_EMAILS). Hosted
 * deployments set this; self-host installs leave it empty and instead promote
 * the first account to owner (see the first-user-becomes-owner bootstrap).
 */
export function hasConfiguredAdminEmails(): boolean {
  return adminEmails.length > 0;
}
