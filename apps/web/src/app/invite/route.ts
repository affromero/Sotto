import { NextRequest, NextResponse } from 'next/server';
import {
  verifyInviteToken,
  createGateToken,
  gateCookieOptions,
  GATE_COOKIE,
} from '@/lib/access/gate';

/**
 * Invite redemption: a valid signed token opens the gate for this browser and
 * lands on the profile picker — invitees never type the access password.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('t') ?? undefined;

  if (!(await verifyInviteToken(token))) {
    return NextResponse.redirect(new URL('/gate', request.url));
  }

  const gateToken = await createGateToken();
  if (!gateToken) {
    return NextResponse.redirect(new URL('/gate', request.url));
  }

  const response = NextResponse.redirect(new URL('/profiles', request.url));
  response.cookies.set(GATE_COOKIE, gateToken, gateCookieOptions());
  return response;
}
