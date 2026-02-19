import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prismaUnfiltered as prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('userId');
  const sig = request.nextUrl.searchParams.get('sig');

  if (!userId || !sig) {
    return new NextResponse('Missing parameters', { status: 400 });
  }

  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || '';
  const expected = crypto.createHmac('sha256', secret).update(userId).digest('hex');

  if (sig !== expected) {
    return new NextResponse('Invalid signature', { status: 403 });
  }

  await prisma.user.update({
    where: { id: userId },
    data: { emailNotifications: false },
  });

  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://sotto.fm';

  return new NextResponse(
    `<html><head><meta charset="utf-8"><title>Unsubscribed — Sotto</title></head>
    <body style="font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;background:#FEFCF8;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
      <div style="max-width:480px;background:#fff;border-radius:12px;border:1px solid #e5e7eb;padding:48px 40px;text-align:center;">
        <h1 style="font-family:'DM Serif Display',Georgia,serif;font-size:28px;color:#1A1A1A;margin:0 0 16px;">
          <span style="color:#D97706;">Sotto</span>
        </h1>
        <h2 style="font-size:18px;color:#1A1A1A;margin:0 0 12px;">You&apos;ve been unsubscribed</h2>
        <p style="font-size:14px;color:#6B7280;line-height:1.6;margin:0 0 24px;">
          You&apos;ve been unsubscribed from Sotto announcements. You&apos;ll no longer receive platform news by email.
        </p>
        <a href="${APP_URL}/settings" style="font-size:13px;color:#D97706;text-decoration:none;">
          Manage notification preferences
        </a>
      </div>
    </body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
