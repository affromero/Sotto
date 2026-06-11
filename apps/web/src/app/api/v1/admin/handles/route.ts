import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prisma } from '@/lib/prisma';
import { isValidHandleFormat } from '@/lib/handles';

import { errorResponse } from '@/lib/api-response';
export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const handles = await prisma.reservedHandle.findMany({
    orderBy: { handle: 'asc' },
  });

  return NextResponse.json({ handles });
}

export async function POST(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json();
  const handle = (body.handle as string)?.toLowerCase()?.trim();
  const reason = body.reason as string | undefined;

  if (!handle || !isValidHandleFormat(handle)) {
    return errorResponse('Invalid handle format (3-30 chars, lowercase alphanumeric + underscore)', 400);
  }

  const existing = await prisma.reservedHandle.findUnique({ where: { handle } });
  if (existing) {
    return errorResponse('Handle already reserved', 409);
  }

  const reserved = await prisma.reservedHandle.create({
    data: {
      handle,
      reason: reason || null,
      createdBy: adminId,
    },
  });

  return NextResponse.json(reserved, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json();
  const handle = (body.handle as string)?.toLowerCase()?.trim();

  if (!handle) {
    return errorResponse('handle is required', 400);
  }

  const existing = await prisma.reservedHandle.findUnique({ where: { handle } });
  if (!existing) {
    return errorResponse('Handle not found', 404);
  }

  await prisma.reservedHandle.delete({ where: { handle } });

  return NextResponse.json({ success: true });
}
