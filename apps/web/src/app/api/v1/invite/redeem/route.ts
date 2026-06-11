import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { redeemInvitationSchema } from '@/lib/validations';
import { errorResponse } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = redeemInvitationSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { code, email } = parsed.data;
  const now = new Date();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const invitation = await tx.invitationLink.findUnique({
        where: { code },
      });

      if (!invitation) {
        return { error: 'Invitation not found', status: 404 };
      }
      if (!invitation.enabled) {
        return { error: 'This invitation has been disabled', status: 400 };
      }
      if (invitation.usedAt) {
        return { error: 'This invitation has already been used', status: 400 };
      }
      if (invitation.expiresAt < now) {
        return { error: 'This invitation has expired', status: 400 };
      }

      // Mark invitation as used. A used InvitationLink carrying this email is
      // the access grant the signIn callback checks when signups are closed.
      await tx.invitationLink.update({
        where: { id: invitation.id },
        data: { email, usedAt: now },
      });

      return { success: true };
    });

    if ('error' in result && result.error) {
      return errorResponse(result.error, result.status);
    }

    return NextResponse.json({ success: true, message: 'You have been approved! Sign in to get started.' });
  } catch (err) {
    // Race condition: another request redeemed first
    if (err instanceof Error && err.message.includes('unique constraint')) {
      return errorResponse('This invitation has already been used', 400);
    }
    throw err;
  }
}
