import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth-guards';
import { toggleInvitationSchema } from '@/lib/validations';
import { errorResponse } from '@/lib/api-response';
import { getAppBaseUrl } from '@/lib/urls';

function generateInviteCode(): string {
  return crypto.randomBytes(9).toString('base64url').slice(0, 12);
}

function getInvitationStatus(inv: {
  usedAt: Date | null;
  enabled: boolean;
  expiresAt: Date;
}): string {
  if (inv.usedAt) return 'used';
  if (!inv.enabled) return 'disabled';
  if (inv.expiresAt < new Date()) return 'expired';
  return 'active';
}

export async function POST() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const code = generateInviteCode();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const invitation = await prisma.invitationLink.create({
    data: {
      code,
      createdBy: adminId,
      expiresAt,
    },
  });

  const baseUrl = getAppBaseUrl();
  const url = `${baseUrl}/invite/${code}`;

  return NextResponse.json({ invitation, url }, { status: 201 });
}

export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const invitations = await prisma.invitationLink.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      creator: {
        select: { name: true, email: true },
      },
    },
  });

  const withStatus = invitations.map((inv) => ({
    ...inv,
    status: getInvitationStatus(inv),
  }));

  return NextResponse.json({ invitations: withStatus });
}

export async function PATCH(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json();
  const parsed = toggleInvitationSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { id, enabled } = parsed.data;

  const existing = await prisma.invitationLink.findUnique({ where: { id } });
  if (!existing) {
    return errorResponse('Invitation not found', 404);
  }

  const updated = await prisma.invitationLink.update({
    where: { id },
    data: { enabled },
  });

  return NextResponse.json({ invitation: { ...updated, status: getInvitationStatus(updated) } });
}
