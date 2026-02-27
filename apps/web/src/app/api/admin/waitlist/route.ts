import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth-guards';
import { adminWaitlistActionSchema, adminWaitlistDeleteSchema } from '@/lib/validations';
import { sendEmail } from '@/lib/email';
import { buildWaitlistApprovalEmail } from '@/lib/email-templates';
import { logger } from '@/lib/logger';
import { errorResponse } from '@/lib/api-response';

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

  const updated = await prisma.waitlist.update({
    where: { id },
    data: {
      status,
      ...(status === 'APPROVED' ? { approvedAt: new Date(), approvedBy: adminId } : {}),
    },
  });

  // Send approval email
  if (status === 'APPROVED' && !entry.unsubscribed) {
    const { subject, html } = buildWaitlistApprovalEmail(entry.email);
    const sent = await sendEmail({ to: entry.email, subject, html });
    if (!sent) {
      logger.warn('Waitlist approval email failed', { email: entry.email, waitlistId: id });
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
