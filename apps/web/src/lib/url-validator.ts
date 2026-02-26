import { lookup } from 'dns/promises';

export class UrlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UrlValidationError';
  }
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.internal',
]);

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;

  // 127.0.0.0/8
  if (parts[0] === 127) return true;
  // 10.0.0.0/8
  if (parts[0] === 10) return true;
  // 172.16.0.0/12
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  // 192.168.0.0/16
  if (parts[0] === 192 && parts[1] === 168) return true;
  // 169.254.0.0/16 (link-local)
  if (parts[0] === 169 && parts[1] === 254) return true;
  // 0.0.0.0
  if (parts.every((p) => p === 0)) return true;

  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  // ::1
  if (normalized === '::1') return true;
  // fc00::/7 (unique local)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  // fe80::/10 (link-local)
  if (normalized.startsWith('fe80')) return true;
  // :: (unspecified)
  if (normalized === '::') return true;

  return false;
}

/**
 * Validate a URL is safe for server-side fetching.
 * Rejects private/reserved IPs, non-HTTP(S) schemes, and known metadata endpoints.
 * Throws UrlValidationError on invalid URLs.
 */
export async function validateUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UrlValidationError('Invalid URL format');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UrlValidationError(`Unsupported protocol: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new UrlValidationError(`Blocked hostname: ${hostname}`);
  }

  // Check if hostname is a raw IP address
  const ipv4Match = hostname.match(/^(\d{1,3}\.){3}\d{1,3}$/);
  if (ipv4Match) {
    if (isPrivateIPv4(hostname)) {
      throw new UrlValidationError('URL resolves to a private IP address');
    }
    return;
  }

  // IPv6 in brackets
  const ipv6Match = hostname.match(/^\[(.+)\]$/);
  if (ipv6Match) {
    if (isPrivateIPv6(ipv6Match[1])) {
      throw new UrlValidationError('URL resolves to a private IP address');
    }
    return;
  }

  // DNS resolve and check
  try {
    const result = await lookup(hostname, { all: true });
    for (const entry of result) {
      if (entry.family === 4 && isPrivateIPv4(entry.address)) {
        throw new UrlValidationError('URL resolves to a private IP address');
      }
      if (entry.family === 6 && isPrivateIPv6(entry.address)) {
        throw new UrlValidationError('URL resolves to a private IP address');
      }
    }
  } catch (err) {
    if (err instanceof UrlValidationError) throw err;
    throw new UrlValidationError(`DNS resolution failed for ${hostname}`);
  }
}

const MAX_REDIRECTS = 5;

/**
 * Fetch a URL with SSRF-safe redirect handling.
 * Validates the initial URL and every redirect hop against private IP ranges.
 * Uses redirect: 'manual' to intercept and re-validate each Location header.
 */
export async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  await validateUrl(url);

  let currentUrl = url;
  for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
    const response = await fetch(currentUrl, {
      ...init,
      redirect: 'manual',
    });

    if (response.status < 300 || response.status >= 400) {
      return response;
    }

    const location = response.headers.get('location');
    if (!location) {
      return response;
    }

    // Resolve relative redirects against the current URL
    const resolved = new URL(location, currentUrl).href;
    await validateUrl(resolved);
    currentUrl = resolved;
  }

  throw new UrlValidationError(`Too many redirects (max ${MAX_REDIRECTS})`);
}
