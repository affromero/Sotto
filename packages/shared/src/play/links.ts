import { z } from 'zod';

export const playInviteCodeSchema = z.string().regex(/^[A-HJ-NP-Z2-9]{12}$/);
export const playInviteEnvelopeSchema = z.strictObject({
  version: z.literal(1),
  serverUrl: z
    .url()
    .max(2048)
    .refine((value) => serverOrigin(value) === value, {
      message: 'Invitation server must be a credential-free HTTP(S) origin.',
    }),
  code: playInviteCodeSchema,
});
export type PlayInviteEnvelope = z.infer<typeof playInviteEnvelopeSchema>;

export function normalizePlayInviteCode(value: string): string | null {
  const parsed = playInviteCodeSchema.safeParse(value.replace(/[\s-]/g, '').toUpperCase());
  return parsed.success ? parsed.data : null;
}

export function formatPlayInviteCode(value: string): string {
  const code = normalizePlayInviteCode(value);
  if (!code) throw new Error('Invalid invitation code');
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
}

function serverOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      return null;
    return url.origin.length <= 2048 ? url.origin : null;
  } catch {
    return null;
  }
}

/** Transport policies still decide whether an HTTP host is local and reachable. */
export function parsePlayInviteLink(
  value: string,
  bridgeOrigin = 'https://sotto.fm'
): PlayInviteEnvelope | null {
  if (value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return null;
    const native = url.protocol === 'sotto:' && url.host === 'play' && url.pathname === '/join';
    const web = ['https:', 'http:'].includes(url.protocol) && url.pathname === '/play/join';
    if (!native && !web) return null;
    const keys = [...url.searchParams.keys()];
    if (
      new Set(keys).size !== keys.length ||
      keys.some((key) => !['v', 'server', 'code'].includes(key)) ||
      url.searchParams.get('v') !== '1'
    )
      return null;
    const server = url.searchParams.get('server');
    if (native && !server) return null;
    if (server && !native && url.origin !== bridgeOrigin) return null;
    const origin = serverOrigin(server ?? url.origin);
    const code = normalizePlayInviteCode(url.searchParams.get('code') ?? '');
    return origin && code ? { version: 1, serverUrl: origin, code } : null;
  } catch {
    return null;
  }
}

export function createPlayInviteLink(serverUrl: string, value: string): string {
  const origin = serverOrigin(serverUrl);
  const code = normalizePlayInviteCode(value);
  if (!origin || !code) throw new Error('Invalid invitation');
  const url = new URL('/play/join', origin);
  url.searchParams.set('v', '1');
  url.searchParams.set('code', code);
  return url.toString();
}

export function createPlayAppLink(invitation: PlayInviteEnvelope): string {
  const parsed = playInviteEnvelopeSchema.parse(invitation);
  const origin = serverOrigin(parsed.serverUrl);
  if (!origin) throw new Error('Invalid invitation server');
  const url = new URL('sotto://play/join');
  url.searchParams.set('v', '1');
  url.searchParams.set('server', origin);
  url.searchParams.set('code', parsed.code);
  return url.toString();
}
