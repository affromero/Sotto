import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { accessPasswordConfigured, createInviteToken, INVITE_TTL_MS } from '@/lib/access/gate';
import { generateQrDataUrl } from '@/lib/qr';

/** Owner-only: mint a fresh invite link + QR that pre-opens the access gate. */
export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Admin access required', 403);
  }

  if (!accessPasswordConfigured()) {
    return errorResponse('No access password is configured on this instance', 404);
  }

  const token = await createInviteToken();
  if (!token) {
    return errorResponse('Instance is missing BYOK_ENCRYPTION_KEY', 500);
  }

  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const inviteUrl = `${base.replace(/\/$/, '')}/invite?t=${token}`;
  const qrDataUrl = await generateQrDataUrl(inviteUrl);

  return NextResponse.json({
    inviteUrl,
    qrDataUrl,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
  });
}
