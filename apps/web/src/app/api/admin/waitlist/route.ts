import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth-guards';
import { adminWaitlistActionSchema } from '@/lib/validations';
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

  // Send approval email (fire-and-forget)
  if (status === 'APPROVED') {
    import('@/lib/email-templates').then(({ buildWaitlistApprovalEmail }) =>
      import('@/lib/email').then(({ sendEmail }) => {
        const { subject, html } = buildWaitlistApprovalEmail(entry.email);
        sendEmail({ to: entry.email, subject, html }).catch(() => {});
      })
    );
  }

  return NextResponse.json({ entry: updated });
}
