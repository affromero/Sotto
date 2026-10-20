type PlayDistribution = {
  ios: string | null;
  androidStore: string | null;
  androidApk: string | null;
};

function configuredUrl(name: string, host?: string): string | null {
  const value = process.env[name]?.trim();
  if (!value) return null;
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    (host && url.origin !== `https://${host}`)
  )
    throw new Error(`${name} must be a clean HTTPS download URL${host ? ` on ${host}` : ''}.`);
  return url.toString();
}

/** Missing publication is explicit. Never invent an App Store or Play listing. */
export function playDistribution(): PlayDistribution {
  return {
    ios: configuredUrl('SOTTO_IOS_APP_STORE_URL', 'apps.apple.com'),
    androidStore: configuredUrl('SOTTO_ANDROID_PLAY_STORE_URL', 'play.google.com'),
    androidApk: configuredUrl('SOTTO_ANDROID_APK_URL'),
  };
}

export type { PlayDistribution };
