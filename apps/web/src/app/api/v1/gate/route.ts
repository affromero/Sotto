import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit } from '@/lib/redis';
import { errorResponse } from '@/lib/api-response';
import {
  accessPasswordConfigured,
  accessPasswordMeetsSecurityPolicy,
  verifyAccessPassword,
  createGateToken,
  gateCookieOptions,
  GATE_COOKIE,
} from '@/lib/access/gate';

const gateSchema = z.object({ password: z.string().min(1).max(500) });

export async function POST(request: NextRequest) {
  if (!accessPasswordConfigured()) {
    return errorResponse('No access password is configured on this instance', 404);
  }
  if (!accessPasswordMeetsSecurityPolicy()) {
    return errorResponse('The instance access password does not meet security policy', 503);
  }

  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite === 'cross-site') {
    return errorResponse('Request rejected', 403);
  }

  const ip =
    request.headers.get('cf-connecting-ip')?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';
  const [clientLimit, sustainedLimit] = await Promise.all([
    checkRateLimit(`gate:client:${ip}`, 5, 60),
    checkRateLimit(`gate:sustained:${ip}`, 20, 15 * 60),
  ]);
  if (!clientLimit.allowed || !sustainedLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again later.' },
      { status: 429, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const parsed = gateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse('Password is required', 400);
  }

  if (!(await verifyAccessPassword(parsed.data.password))) {
    return errorResponse('Wrong password', 401);
  }

  const token = await createGateToken();
  if (!token) {
    return errorResponse('Instance is missing BYOK_ENCRYPTION_KEY', 500);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(GATE_COOKIE, token, gateCookieOptions());
  return response;
}
