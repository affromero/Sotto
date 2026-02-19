import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  const sig = request.nextUrl.searchParams.get('sig');

  if (!email || !sig) {
    return new NextResponse('Missing parameters', { status: 400 });
  }

  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || '';
  const expected = crypto
    .createHmac('sha256', secret)
    .update(email)
    .digest('hex');

  if (sig !== expected) {
    return new NextResponse('Invalid signature', { status: 403 });
  }

  await prisma.waitlist.updateMany({
    where: { email },
    data: { unsubscribed: true },
  });

  return new NextResponse(
    `<html><body style="font-family:sans-serif;text-align:center;padding:60px 20px;">
      <h1>Unsubscribed</h1>
      <p>You've been removed from Sotto emails. Sorry to see you go.</p>
    </body></html>`,
    {
      headers: { 'Content-Type': 'text/html' },
    }
  );
}
