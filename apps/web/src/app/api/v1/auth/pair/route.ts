import { NextRequest, NextResponse } from 'next/server';
import { resolveReachUrl } from 'thesidedoor/server';
import { cookieValue, readAccessJson } from 'thesidedoor-core/access/http';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { SHARED_SESSION_COOKIE } from '@/lib/sidedoor/access/core/session-identity';
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
  return accessOperation(request, true, () => issue(request));
}

async function issue(request: NextRequest) {
  if (request.headers.has('authorization'))
    return errorResponse('Browser sign-in is required to pair a new device', 403);
  const sessionToken = cookieValue(request, SHARED_SESSION_COOKIE);
  if (!sessionToken) return errorResponse('Unauthorized', 401);

  const body = await readAccessJson(request);
  const parsed = pairDeviceSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.flatten(), 400);

  const { token, expiresAt } = await createPairingToken(sessionToken, parsed.data.name);
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
