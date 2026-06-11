import { getStoredServerUrl } from './server-url';

const API_URL_ENV = 'EXPO_PUBLIC_API_URL';

export class MobileConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MobileConfigError';
  }
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function parseExplicitUrl(value: string, envName: string): URL {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new MobileConfigError(`${envName} must use http or https.`);
    }
    parsed.hash = '';
    parsed.search = '';
    return parsed;
  } catch (error) {
    if (error instanceof MobileConfigError) throw error;
    throw new MobileConfigError(`${envName} must be a valid absolute URL.`);
  }
}

export function getApiBaseUrl(): string {
  // Prefer the server paired at runtime ("scan to connect"); fall back to a
  // build-time EXPO_PUBLIC_API_URL so dev/baked builds keep working.
  const value = (getStoredServerUrl() ?? process.env.EXPO_PUBLIC_API_URL ?? '').trim();

  if (!value) {
    throw new MobileConfigError(
      `No Sotto server is configured. Connect to your server first, or set ${API_URL_ENV} for a baked-in build.`
    );
  }

  const url = parseExplicitUrl(value, API_URL_ENV);
  const pathname = trimTrailingSlashes(url.pathname);

  if (!pathname || pathname === '/') {
    url.pathname = '/api/v1';
  } else if (pathname.endsWith('/api/v1')) {
    url.pathname = pathname;
  } else if (pathname.endsWith('/api')) {
    url.pathname = `${pathname}/v1`;
  } else {
    throw new MobileConfigError(
      `${API_URL_ENV} must point to a Sotto deployment root or API path ending in /api/v1.`
    );
  }

  return trimTrailingSlashes(url.toString());
}

export function getAppBaseUrl(): string {
  const apiUrl = new URL(getApiBaseUrl());
  const pathname = trimTrailingSlashes(apiUrl.pathname);

  if (pathname === '/api/v1') {
    apiUrl.pathname = '/';
  } else if (pathname === '/api') {
    apiUrl.pathname = '/';
  } else if (pathname.endsWith('/api/v1')) {
    apiUrl.pathname = pathname.slice(0, -7) || '/';
  } else if (pathname.endsWith('/api')) {
    apiUrl.pathname = pathname.slice(0, -4) || '/';
  }

  return trimTrailingSlashes(apiUrl.toString());
}

export function appUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getAppBaseUrl()}${normalizedPath}`;
}
