/**
 * Whether this deployment is a self-hosted instance (the default) or the managed
 * sotto.fm showcase. Self-hosted instances persist real onboarding choices and
 * let the owner configure infrastructure in-app. The managed showcase runs the
 * onboarding wizard as a non-persisting demo (`SELF_HOSTED=false`).
 *
 * Defaults to self-hosted (true) so a fresh OSS clone works without setting it.
 */
export function isSelfHosted(): boolean {
  const raw = (process.env.SELF_HOSTED ?? '').trim().toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  return true;
}
