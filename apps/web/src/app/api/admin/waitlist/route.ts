import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth-guards';
import { adminWaitlistActionSchema, adminWaitlistDeleteSchema } from '@/lib/validations';
import { assertEmailDeliveryConfigured, sendEmail } from '@/lib/email';
import { buildWaitlistApprovalEmail } from '@/lib/email-templates';
import { logger } from '@/lib/logger';
import { errorResponse } from '@/lib/api-response';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function PATCH(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json();
  const parsed = adminWaitlistActionSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { id, status } = parsed.data;

  const entry = await prisma.waitlist.findUnique({ where: { id } });
  if (!entry) {
    return errorResponse('Waitlist entry not found', 404);
  }

  const shouldSendApprovalEmail = status === 'APPROVED' && !entry.unsubscribed;
  if (shouldSendApprovalEmail) {
    try {
      assertEmailDeliveryConfigured();
    } catch (error) {
      logger.error('Waitlist approval email is not configured', {
        email: entry.email,
        waitlistId: id,
        error: getErrorMessage(error),
      });
      return errorResponse('Email delivery is not configured', 503);
    }
  }

  const updated = await prisma.waitlist.update({
    where: { id },
    data: {
      status,
      ...(status === 'APPROVED' ? { approvedAt: new Date(), approvedBy: adminId } : {}),
    },
  });

  // Send approval email
  if (shouldSendApprovalEmail) {
    const { subject, html } = buildWaitlistApprovalEmail(entry.email);
    try {
      await sendEmail({ to: entry.email, subject, html });
    } catch (error) {
      logger.error('Waitlist approval email failed', {
        email: entry.email,
        waitlistId: id,
        error: getErrorMessage(error),
      });
      return errorResponse('Waitlist approval email failed', 502);
    }
  }

  return NextResponse.json({ entry: updated });
}

export async function DELETE(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json();
  const parsed = adminWaitlistDeleteSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { id } = parsed.data;

  const entry = await prisma.waitlist.findUnique({ where: { id } });
  if (!entry) {
    return errorResponse('Waitlist entry not found', 404);
  }

  await prisma.waitlist.delete({ where: { id } });

  return NextResponse.json({ deleted: true });
}
