import { setStoredServerUrl } from './server-url';
import { setToken, notifyAuthSuccess } from './auth';

/**
 * Normalize a user-entered server address to a bare origin (no trailing slash,
 * no /api suffix, default http:// if no scheme). Throws on an invalid URL.
 */
export function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('Enter your server address.');
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const url = new URL(withScheme); // throws on invalid input
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Server address must use http or https.');
  }
  let path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith('/api')) path = path.slice(0, -4);
  url.pathname = path || '/';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

/** Store a server address. The app then routes the learner to sign in. */
export async function connectToServer(rawUrl: string): Promise<void> {
  await setStoredServerUrl(normalizeServerUrl(rawUrl));
}

/**
 * Redeem a "scan to connect" pairing token against a server: stores the server
 * and exchanges the token for a session key, then signs the learner in.
 */
export async function pairWithToken(rawUrl: string, token: string): Promise<void> {
  const serverRoot = normalizeServerUrl(rawUrl);
  const res = await fetch(`${serverRoot}/api/auth/pair/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: token.trim() }),
  });
  if (!res.ok) {
    throw new Error('Pairing failed — the code may have expired or already been used.');
  }
  const data = (await res.json()) as { token: string };
  await setStoredServerUrl(serverRoot);
  await setToken(data.token);
  notifyAuthSuccess();
}
