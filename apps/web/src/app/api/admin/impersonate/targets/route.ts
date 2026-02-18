import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const sotto = await prisma.user.findUnique({
    where: { handle: 'sotto' },
    select: { id: true, name: true, image: true, handle: true },
  });

  return NextResponse.json({ sotto: sotto ?? null });
}
