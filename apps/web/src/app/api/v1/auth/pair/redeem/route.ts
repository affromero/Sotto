import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { redeemPairingToken } from '@/lib/pairing';
import { generateApiKey } from '@/lib/api-keys';
import { redeemPairingSchema } from '@/lib/validations';
import { errorResponse } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/pair/redeem — a new device exchanges a pairing token for a
 * long-lived API key. Unauthenticated by design (the token IS the credential);
 * the token is single-use and short-lived. Mirrors /api/auth/mobile's key mint.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const parsed = redeemPairingSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.flatten(), 400);

  const redeemed = await redeemPairingToken(parsed.data.token);
  if (!redeemed) return errorResponse('Invalid or expired pairing token', 401);

  const { key, hash, prefix } = generateApiKey();
  await prisma.apiKey.create({
    data: { userId: redeemed.userId, name: redeemed.name, keyHash: hash, keyPrefix: prefix },
  });

  const user = await prisma.user.findUnique({
    where: { id: redeemed.userId },
    select: { id: true, name: true, email: true, image: true, role: true },
  });

  return NextResponse.json({ token: key, user });
}
