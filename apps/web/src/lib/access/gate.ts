/**
 * Instance access gate for publicly exposed installs. Sotto has no login: the
 * household picks profiles from a passwordless picker. When an instance is
 * reachable from the internet, the owner sets SOTTO_ACCESS_PASSWORD and this
 * gate stands in front of everything — one shared password (or an invite
 * link/QR) opens the instance, then the normal picker takes over. When the
 * password is unset (localhost, tunnels, the managed showcase) the gate is
 * completely inert.
 *
 * Tokens are HMAC-SHA256 over `<scope>.<expiry>` signed with a key derived
 * from the required BYOK_ENCRYPTION_KEY, so no extra secret is needed and
 * rotating that key revokes every outstanding gate cookie and invite link.
 * Implemented on Web Crypto only, so the proxy (Edge runtime) and route
 * handlers (Node) share one implementation.
 */

export const GATE_COOKIE = 'sotto_gate';

const GATE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const encoder = new TextEncoder();

export function accessPasswordConfigured(): boolean {
  return Boolean(process.env.SOTTO_ACCESS_PASSWORD);
}

async function digestHex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time hex comparison (both inputs are fixed-length digests). */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyAccessPassword(password: string): Promise<boolean> {
  const configured = process.env.SOTTO_ACCESS_PASSWORD;
  if (!configured) return false;
  return constantTimeEqual(await digestHex(password), await digestHex(configured));
}

async function signingKey(): Promise<CryptoKey | null> {
  const material = process.env.BYOK_ENCRYPTION_KEY;
  if (!material) return null;
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(`${material}:sotto-access-gate`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

async function signPayload(payload: string): Promise<string | null> {
  const key = await signingKey();
  if (!key) return null;
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function createToken(scope: 'gate' | 'invite', ttlMs: number): Promise<string | null> {
  const expiry = Date.now() + ttlMs;
  const sig = await signPayload(`${scope}.${expiry}`);
  return sig ? `${expiry}.${sig}` : null;
}

async function verifyToken(scope: 'gate' | 'invite', token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const expiry = Number(token.slice(0, dot));
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;
  const expected = await signPayload(`${scope}.${expiry}`);
  return expected !== null && constantTimeEqual(token.slice(dot + 1), expected);
}

export const createGateToken = () => createToken('gate', GATE_TTL_MS);
export const verifyGateToken = (token: string | undefined) => verifyToken('gate', token);
export const createInviteToken = () => createToken('invite', INVITE_TTL_MS);
export const verifyInviteToken = (token: string | undefined) => verifyToken('invite', token);

export function gateCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(GATE_TTL_MS / 1000),
  };
}
