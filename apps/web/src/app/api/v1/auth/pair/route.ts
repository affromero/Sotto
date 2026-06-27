import { NextRequest, NextResponse } from 'next/server';
import { resolveReachUrl } from 'thesidedoor/server';
import { auth } from '@/lib/auth';
import { createPairingToken } from '@/lib/pairing';
import { detectTailscaleServeUrl } from '@/lib/tailscale-reach';
import { pairDeviceSchema } from '@/lib/validations';
import { errorResponse } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/pair — issue a short-lived "scan to connect" token for the
 * signed-in learner. The web client renders the returned payload as a QR; a
 * phone/tablet redeems it at /api/auth/pair/redeem for a long-lived API key.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return errorResponse('Unauthorized', 401);

  const body = await request.json().catch(() => ({}));
  const parsed = pairDeviceSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.flatten(), 400);

  const { token, expiresAt } = await createPairingToken(session.user.id, parsed.data.name);
  const detectedServeUrl = parsed.data.reachUrl ? null : await detectTailscaleServeUrl(3000);
  const serverUrl = resolveReachUrl({
    configuredUrl: parsed.data.reachUrl ?? detectedServeUrl,
    headers: request.headers,
    defaultHost: request.nextUrl.host,
  });

  return NextResponse.json(
    {
      token,
      serverUrl,
      // A scannable connect URL; a client opens it and redeems the token.
      connectUrl: `${serverUrl}/connect?token=${encodeURIComponent(token)}`,
      expiresAt: expiresAt.toISOString(),
    },
    { status: 201 }
  );
}
