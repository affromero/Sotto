import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit } from '@/lib/redis';
import { errorResponse } from '@/lib/api-response';
import {
  accessPasswordConfigured,
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

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const { allowed, resetAt } = await checkRateLimit(`gate:${ip}`, 5, 60);
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again shortly.' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))) },
      }
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
