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

function createAccessToken(secret: string): string {
  const timestamp = Date.now().toString();
  const hmac = crypto.createHmac('sha256', secret).update(timestamp).digest('hex');
  return `${timestamp}:${hmac}`;
}

export async function GET(request: NextRequest) {
  const sitePassword = process.env.SITE_PASSWORD;
  if (!sitePassword) {
    return NextResponse.json({ gated: false });
  }

  const secret = process.env.NEXTAUTH_SECRET;
  const cookie = request.cookies.get('sotto_access');

  if (!cookie?.value || !secret) {
    return NextResponse.json({ gated: true, hasAccess: false });
  }

  const separatorIndex = cookie.value.indexOf(':');
  if (separatorIndex === -1) {
    return NextResponse.json({ gated: true, hasAccess: false });
  }

  const timestamp = cookie.value.substring(0, separatorIndex);
  const signature = cookie.value.substring(separatorIndex + 1);
  const age = Date.now() - parseInt(timestamp, 10);

  if (isNaN(age) || age < 0 || age > 30 * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ gated: true, hasAccess: false });
  }

  const expectedSig = crypto.createHmac('sha256', secret).update(timestamp).digest('hex');
  const expectedBuf = Buffer.from(expectedSig);
  const signatureBuf = Buffer.from(signature);
  const hasAccess = expectedBuf.length === signatureBuf.length && crypto.timingSafeEqual(expectedBuf, signatureBuf);

  return NextResponse.json({ gated: true, hasAccess });
}

export async function POST(request: NextRequest) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || !process.env.SITE_PASSWORD) {
    return errorResponse('Password gate not configured', 500);
  }

  // Rate limit: 3 attempts per 15 minutes per IP
  const ip = getClientIp(request);
  const { allowed, resetAt } = await checkRateLimit(`access:${ip}`, 3, 15 * 60);
  if (!allowed) {
    const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
    return errorResponse('Too many attempts. Try again later.', 429, undefined, { 'Retry-After': retryAfter.toString() });
  }

  const { password } = await request.json();

  // Constant-time comparison
  const input = Buffer.from(String(password));
  const expected = Buffer.from(process.env.SITE_PASSWORD);
  const isValid = input.length === expected.length && crypto.timingSafeEqual(input, expected);

  if (!isValid) {
    return errorResponse('Invalid password', 401);
  }

  const token = createAccessToken(secret);
  const response = NextResponse.json({ success: true });
  response.cookies.set('sotto_access', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60, // 30 days
    path: '/',
  });

  return response;
}
