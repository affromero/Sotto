import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { checkRateLimit } from '@/lib/redis';

import { errorResponse } from '@/lib/api-response';
function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return '127.0.0.1';
}

function createPitchToken(secret: string): string {
  const timestamp = Date.now().toString();
  const hmac = crypto.createHmac('sha256', secret).update(timestamp).digest('hex');
  return `${timestamp}:${hmac}`;
}

export async function POST(request: NextRequest) {
  const secret = process.env.NEXTAUTH_SECRET;
  const pitchPassword = process.env.PITCH_PASSWORD;

  if (!secret || !pitchPassword) {
    return errorResponse('Pitch gate not configured', 500);
  }

  const ip = getClientIp(request);
  const { allowed, resetAt } = await checkRateLimit(`pitch:${ip}`, 3, 15 * 60);
  if (!allowed) {
    const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
    return errorResponse('Too many attempts. Try again later.', 429, undefined, { 'Retry-After': retryAfter.toString() });
  }

  const { password } = await request.json();

  const input = Buffer.from(String(password));
  const expected = Buffer.from(pitchPassword);
  const isValid = input.length === expected.length && crypto.timingSafeEqual(input, expected);

  if (!isValid) {
    return errorResponse('Invalid password', 401);
  }

  const token = createPitchToken(secret);
  const response = NextResponse.json({ success: true });
  response.cookies.set('sotto_pitch', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60, // 1 hour
    path: '/',
  });

  return response;
}
