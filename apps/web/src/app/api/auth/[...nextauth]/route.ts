import { handlers } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/redis';

export const GET = handlers.GET;

export async function POST(request: NextRequest) {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : '127.0.0.1';
  const { allowed } = await checkRateLimit(`auth:nextauth:${ip}`, 20, 15 * 60);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many attempts' }, { status: 429 });
  }
  return handlers.POST(request);
}
