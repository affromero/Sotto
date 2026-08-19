import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { authenticateRequest } from '@/lib/api-keys';
import { isUserAdmin } from '@/lib/auth-guards';
import { getHealthData } from '@/lib/health';

export const dynamic = 'force-dynamic';

async function isBearerAdmin(request: NextRequest): Promise<boolean> {
  if (!request.headers.get('authorization')?.startsWith('Bearer ')) return false;
  const authed = await authenticateRequest(request);
  return authed ? isUserAdmin(authed.userId) : false;
}

let publicHealthCache: { expiresAt: number; value: ReturnType<typeof getHealthData> } | null = null;

/**
 * Deliberately dual-mode: anonymous callers get a cached public payload that
 * deploy tooling polls, and admins additionally get checks and provider env
 * booleans. The admin half now also answers a `sk_sotto_` Bearer client (the
 * app), which the session lookup alone cannot see; the anonymous path is
 * untouched, so swapping to Bearer-only would have broken the probes.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  const isAdmin = session?.user?.role === 'ADMIN' || (await isBearerAdmin(request));
  let value: ReturnType<typeof getHealthData>;
  if (isAdmin || process.env.NODE_ENV !== 'production') {
    value = getHealthData(isAdmin);
  } else if (publicHealthCache && publicHealthCache.expiresAt > Date.now()) {
    value = publicHealthCache.value;
  } else {
    value = getHealthData(false);
    publicHealthCache = { expiresAt: Date.now() + 5000, value };
  }
  const data = await value;
  return NextResponse.json(data, { status: data.status === 'healthy' ? 200 : 503 });
}
