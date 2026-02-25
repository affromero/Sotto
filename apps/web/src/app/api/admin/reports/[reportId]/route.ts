import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { resolveReportSchema } from '@/lib/validations';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ reportId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { reportId } = await params;
  const session = await auth();

  if (!session?.user?.id || session.user.role !== 'ADMIN') {
    return errorResponse('Forbidden', 403);
  }

  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: {
      reporter: { select: { id: true, name: true, email: true, handle: true } },
    },
  });

  if (!report) {
    return errorResponse('Report not found', 404);
  }

  return NextResponse.json(report);
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { reportId } = await params;
  const session = await auth();

  if (!session?.user?.id || session.user.role !== 'ADMIN') {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json();
  const parsed = resolveReportSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: { id: true, status: true },
  });

  if (!report) {
    return errorResponse('Report not found', 404);
  }

  if (report.status.startsWith('RESOLVED')) {
    return errorResponse('Report already resolved', 409);
  }

  const updated = await prisma.report.update({
    where: { id: reportId },
    data: {
      status: parsed.data.status,
      resolution: parsed.data.resolution ?? null,
      resolvedBy: session.user.id,
      resolvedAt: new Date(),
    },
  });

  return NextResponse.json(updated);
}
