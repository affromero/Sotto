import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prisma } from '@/lib/prisma';
import { isValidHandleFormat } from '@/lib/handles';

export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const handles = await prisma.reservedHandle.findMany({
    orderBy: { handle: 'asc' },
  });

  return NextResponse.json({ handles });
}

export async function POST(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const handle = (body.handle as string)?.toLowerCase()?.trim();
  const reason = body.reason as string | undefined;

  if (!handle || !isValidHandleFormat(handle)) {
    return NextResponse.json(
      { error: 'Invalid handle format (3-30 chars, lowercase alphanumeric + underscore)' },
      { status: 400 }
    );
  }

  const existing = await prisma.reservedHandle.findUnique({ where: { handle } });
  if (existing) {
    return NextResponse.json({ error: 'Handle already reserved' }, { status: 409 });
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
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const handle = (body.handle as string)?.toLowerCase()?.trim();

  if (!handle) {
    return NextResponse.json({ error: 'handle is required' }, { status: 400 });
  }

  const existing = await prisma.reservedHandle.findUnique({ where: { handle } });
  if (!existing) {
    return NextResponse.json({ error: 'Handle not found' }, { status: 404 });
  }

  await prisma.reservedHandle.delete({ where: { handle } });

  return NextResponse.json({ success: true });
}
