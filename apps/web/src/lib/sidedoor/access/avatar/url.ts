import { StorageBackendRegistry } from 'thesidedoor-core/storage';
import type { Prisma } from '@/generated/prisma/client';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { getSiteConfig } from '@/lib/site-config';

/** Address comparisons are conservative around encoding and object-store host aliases. */
export function isManagedAvatarUrl(
  reference: string,
  locations: readonly { publicUrl: string | null; endpoint: string | null; bucket: string | null }[]
) {
  let candidate: URL;
  try {
    candidate = new URL(reference);
  } catch {
    return true;
  }
  if (!['http:', 'https:'].includes(candidate.protocol) || candidate.username || candidate.password)
    return true;
  const hostname = candidate.hostname.replace(/\.+$/, '');
  try {
    let path = candidate.pathname;
    for (let depth = 0; depth < 3; depth++) {
      if (path.replace(/\/{2,}/g, '/').startsWith('/api/v1/storage/')) return true;
      const decoded = decodeURIComponent(path);
      if (decoded === path) break;
      path = decoded;
      if (depth === 2 && path.includes('%')) return true;
    }
    if (path.replace(/\/{2,}/g, '/').startsWith('/api/v1/storage/')) return true;
  } catch {
    return true;
  }
  for (const location of locations) {
    for (const [kind, alias] of [
      ['public', location.publicUrl],
      ['endpoint', location.endpoint],
    ] as const) {
      if (!alias) continue;
      let base: URL;
      try {
        base = new URL(alias);
      } catch {
        throw new Error('Storage URL configuration is invalid');
      }
      const baseHost = base.hostname.replace(/\.+$/, '');
      if (location.bucket !== null && hostname === `${location.bucket}.${baseHost}`) return true;
      if (hostname !== baseHost) continue;
      if (/\/{2,}/.test(candidate.pathname)) return true;
      if (candidate.pathname.includes('%')) return true;
      if (kind === 'public') {
        const prefix = base.pathname.replace(/\/+$/, '');
        if (!prefix || candidate.pathname === prefix || candidate.pathname.startsWith(`${prefix}/`))
          return true;
        continue;
      }
      if (!location.bucket) return true;
      const bucketPath = `${base.pathname.replace(/\/+$/, '')}/${location.bucket}`;
      if (candidate.pathname === bucketPath || candidate.pathname.startsWith(`${bucketPath}/`))
        return true;
    }
  }
  return false;
}

/** Historical storage URLs remain protected even after a backend is reconfigured. */
export async function requireExternalAvatarUrl(
  database: Prisma.TransactionClient,
  reference: string
) {
  if (reference.startsWith('/avatars/')) return;
  const config = await getSiteConfig({ database });
  const locations = [
    {
      publicUrl: config.objectStoragePublicUrl,
      endpoint: config.objectStorageEndpoint,
      bucket: config.objectStorageBucket,
    },
  ];
  const registry = new StorageBackendRegistry(
    { query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
    'postgres',
    SIDEDOOR_STATE_ID
  );
  let cursor: string | null = null;
  let count = 0;
  do {
    const page = await registry.list(cursor);
    count += page.backends.length;
    if (count > 100_000) throw new Error('Storage backend inventory is too large');
    for (const { descriptor } of page.backends)
      if (descriptor.kind === 'object')
        locations.push({
          publicUrl: descriptor.publicUrl,
          endpoint: descriptor.location.endpoint,
          bucket: descriptor.location.bucket,
        });
    if (cursor && page.cursor && page.cursor <= cursor)
      throw new Error('Storage backend inventory cursor did not advance');
    cursor = page.cursor;
  } while (cursor !== null);
  if (isManagedAvatarUrl(reference, locations)) throw new ManagedAvatarUrlError();
}

export class ManagedAvatarUrlError extends Error {
  constructor() {
    super('Upload this image to use it as an avatar.');
  }
}
