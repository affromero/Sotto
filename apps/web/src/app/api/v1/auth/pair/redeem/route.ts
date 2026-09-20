import { NextRequest, NextResponse } from 'next/server';
import { redeemPairingToken } from '@/lib/pairing';
import { redeemPairingSchema } from '@/lib/validations';
import { errorResponse } from '@/lib/api-response';
import { checkRateLimit } from '@/lib/redis';
import { readAccessJson } from 'thesidedoor-core/access/http';
import { accessOperation } from '@/lib/sidedoor/access/core/http';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/pair/redeem — a new device exchanges a pairing token for a
 * long-lived API key. Unauthenticated by design (the token IS the credential);
 * the token is single-use and short-lived. Mirrors /api/auth/mobile's key mint.
 */
export async function POST(request: NextRequest) {
  return accessOperation(request, false, () => redeem(request));
}

async function redeem(request: NextRequest) {
  const rate = await checkRateLimit('pair-redeem:instance', 10, 60);
  if (!rate.allowed) return errorResponse('Too many attempts. Try again later.', 429);

  const body = await readAccessJson(request);
  const parsed = redeemPairingSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.flatten(), 400);

  const redeemed = await redeemPairingToken(parsed.data.token);
  if (!redeemed) return errorResponse('Invalid or expired pairing token', 401);

  return NextResponse.json(redeemed, { headers: { 'Cache-Control': 'private, no-store' } });
}
