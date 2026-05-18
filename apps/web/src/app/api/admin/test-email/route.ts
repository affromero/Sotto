import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth-guards';
import { sendEmail } from '@/lib/email';
import { errorResponse } from '@/lib/api-response';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const admin = await prisma.user.findUnique({
    where: { id: adminId },
    select: { email: true },
  });

  if (!admin?.email) {
    return errorResponse('Admin email not found', 404);
  }

  try {
    await sendEmail({
      to: admin.email,
      subject: 'Sotto - Test Email',
      html: `<p>This is a test email from Sotto admin panel. If you received this, email delivery is working.</p><p>Sent at: ${new Date().toISOString()}</p>`,
    });
  } catch (error) {
    return errorResponse(`Email send failed: ${getErrorMessage(error)}`, 502);
  }

  return NextResponse.json({ sent: true, to: admin.email });
}
