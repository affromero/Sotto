import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { isUserAdmin } from '@/lib/auth-guards';
import { getHealthData } from '@/lib/health';

export const dynamic = 'force-dynamic';

async function canReadPrivateHealth(request: NextRequest): Promise<boolean> {
  try {
    const authed = await authenticateRequest(request);
    return authed ? isUserAdmin(authed) : false;
  } catch {
    // Public liveness remains available when optional privileged access cannot be verified.
    return false;
  }
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
  const isAdmin = await canReadPrivateHealth(request);
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
  return NextResponse.json(data, {
    status: data.status === 'healthy' ? 200 : 503,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
