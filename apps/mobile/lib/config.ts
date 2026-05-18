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
  const value = process.env.EXPO_PUBLIC_API_URL?.trim();

  if (!value) {
    throw new MobileConfigError(
      `${API_URL_ENV} is required. Set it to your Sotto deployment API URL, for example http://localhost:3000/api.`
    );
  }

  const url = parseExplicitUrl(value, API_URL_ENV);
  const pathname = trimTrailingSlashes(url.pathname);

  if (!pathname || pathname === '/') {
    url.pathname = '/api';
  } else if (pathname.endsWith('/api')) {
    url.pathname = pathname;
  } else {
    throw new MobileConfigError(
      `${API_URL_ENV} must point to a Sotto deployment root or API path ending in /api.`
    );
  }

  return trimTrailingSlashes(url.toString());
}

export function getAppBaseUrl(): string {
  const apiUrl = new URL(getApiBaseUrl());
  const pathname = trimTrailingSlashes(apiUrl.pathname);

  if (pathname === '/api') {
    apiUrl.pathname = '/';
  } else if (pathname.endsWith('/api')) {
    apiUrl.pathname = pathname.slice(0, -4) || '/';
  }

  return trimTrailingSlashes(apiUrl.toString());
}

export function appUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getAppBaseUrl()}${normalizedPath}`;
}
