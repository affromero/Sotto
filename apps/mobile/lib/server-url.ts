import * as SecureStore from 'expo-secure-store';

const SERVER_URL_KEY = 'sotto_server_url';

// In-memory cache so the sync getApiBaseUrl() can read the runtime server URL
// without awaiting SecureStore on every call. Populated once at startup by
// loadStoredServerUrl(), and kept in sync by setStoredServerUrl().
let cachedServerUrl: string | null = null;

/** Read the stored server URL into the cache. Call once at app startup. */
export async function loadStoredServerUrl(): Promise<string | null> {
  try {
    cachedServerUrl = (await SecureStore.getItemAsync(SERVER_URL_KEY)) ?? null;
  } catch {
    cachedServerUrl = null;
  }
  return cachedServerUrl;
}

/** Synchronous cache read used by getApiBaseUrl(). */
export function getStoredServerUrl(): string | null {
  return cachedServerUrl;
}

/** Persist the chosen server URL and update the cache immediately. */
export async function setStoredServerUrl(url: string): Promise<void> {
  cachedServerUrl = url;
  try {
    await SecureStore.setItemAsync(SERVER_URL_KEY, url);
  } catch {
    // SecureStore write failed — the URL works until app restart.
  }
}

/** Forget the paired server (used on "disconnect"). */
export async function clearStoredServerUrl(): Promise<void> {
  cachedServerUrl = null;
  try {
    await SecureStore.deleteItemAsync(SERVER_URL_KEY);
  } catch {
    // ignore
  }
}

/**
 * Whether a server is configured at all — either paired at runtime (cache) or
 * baked in at build time (EXPO_PUBLIC_API_URL). When false, the app routes to
 * the connect screen instead of the login/feed.
 */
export function hasServerConfigured(): boolean {
  return Boolean(cachedServerUrl || process.env.EXPO_PUBLIC_API_URL?.trim());
}
