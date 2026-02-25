import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const sotto = await prisma.user.findUnique({
    where: { handle: 'sotto' },
    select: { id: true, name: true, image: true, handle: true },
  });

  return NextResponse.json({ sotto: sotto ?? null });
}
