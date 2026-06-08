const APP_BASE_URL_ENV_NAMES = ['NEXT_PUBLIC_APP_URL', 'NEXTAUTH_URL'] as const;

export class AppUrlConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppUrlConfigurationError';
  }
}

type AppUrlEnv = Record<string, string | undefined>;

function normalizeAppBaseUrl(value: string, envName: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new AppUrlConfigurationError(`${envName} must not be empty.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new AppUrlConfigurationError(`${envName} must be a valid absolute URL.`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppUrlConfigurationError(`${envName} must use http or https.`);
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new AppUrlConfigurationError(
      `${envName} must be a clean origin URL without credentials, query, or hash.`
    );
  }

  const pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${pathname}`;
}

export function getAppBaseUrl(env: AppUrlEnv = process.env): string {
  for (const envName of APP_BASE_URL_ENV_NAMES) {
    const value = env[envName];
    if (value?.trim()) {
      return normalizeAppBaseUrl(value, envName);
    }
  }

  throw new AppUrlConfigurationError(
    'NEXT_PUBLIC_APP_URL or NEXTAUTH_URL is required to generate absolute Sotto URLs.'
  );
}

export function getPublicAppBaseUrl(env: AppUrlEnv = process.env): string {
  const appUrl = getAppBaseUrl(env);
  const parsed = new URL(appUrl);
  if (parsed.protocol !== 'https:') {
    throw new AppUrlConfigurationError(
      'NEXT_PUBLIC_APP_URL or NEXTAUTH_URL must use https for public bot links.'
    );
  }
  return appUrl;
}

/** Generate a podcast URL. */
export function podcastUrl(
  podcast: { id: string; slug?: string | null },
  handle?: string | null
): string {
  if (podcast.slug && handle) {
    return `/@${handle}/${podcast.slug}`;
  }
  return `/podcast/${podcast.id}`;
}

/**
 * Generate an absolute podcast URL.
 */
export function absolutePodcastUrl(
  podcast: { id: string; slug?: string | null },
  handle?: string | null,
  appUrl = getAppBaseUrl()
): string {
  return `${appUrl}${podcastUrl(podcast, handle)}`;
}
