const APP_BASE_URL_ENV_NAMES = ['NEXT_PUBLIC_APP_URL'] as const;

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
    'NEXT_PUBLIC_APP_URL is required to generate absolute Sotto URLs.'
  );
}

export function getPublicAppBaseUrl(env: AppUrlEnv = process.env): string {
  const appUrl = getAppBaseUrl(env);
  const parsed = new URL(appUrl);
  if (parsed.protocol !== 'https:') {
    throw new AppUrlConfigurationError(
      'NEXT_PUBLIC_APP_URL must use https for public bot links.'
    );
  }
  return appUrl;
}

/** Generate a episode URL. */
export function episodeUrl(episode: { id: string }): string {
  return `/episode/${episode.id}`;
}

/**
 * Generate an absolute episode URL.
 */
export function absoluteEpisodeUrl(
  episode: { id: string },
  appUrl = getAppBaseUrl()
): string {
  return `${appUrl}${episodeUrl(episode)}`;
}
