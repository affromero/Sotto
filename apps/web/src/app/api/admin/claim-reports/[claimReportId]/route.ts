import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { resolveClaimReportSchema } from '@/lib/validations';

type RouteParams = { params: Promise<{ claimReportId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { claimReportId } = await params;
  const session = await auth();

  if (!session?.user?.id || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const parsed = resolveClaimReportSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const report = await prisma.claimReport.findUnique({
    where: { id: claimReportId },
    select: { id: true, status: true },
  });

  if (!report) {
    return NextResponse.json({ error: 'Claim report not found' }, { status: 404 });
  }

  if (report.status.startsWith('RESOLVED') || report.status === 'DISMISSED') {
    return NextResponse.json({ error: 'Claim report already resolved' }, { status: 409 });
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
