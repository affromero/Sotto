import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { resolveClaimReportSchema } from '@/lib/validations';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ claimReportId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { claimReportId } = await params;
  const session = await auth();

  if (!session?.user?.id || session.user.role !== 'ADMIN') {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json();
  const parsed = resolveClaimReportSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const report = await prisma.claimReport.findUnique({
    where: { id: claimReportId },
    select: { id: true, status: true },
  });

  if (!report) {
    return errorResponse('Claim report not found', 404);
  }

  if (report.status.startsWith('RESOLVED') || report.status === 'DISMISSED') {
    return errorResponse('Claim report already resolved', 409);
  }

  const updated = await prisma.claimReport.update({
    where: { id: claimReportId },
    data: {
      status: parsed.data.status,
      resolution: parsed.data.resolution ?? null,
      resolvedBy: session.user.id,
      resolvedAt: new Date(),
    },
  });

  return NextResponse.json(updated);
}
