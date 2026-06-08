import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prisma } from '@/lib/prisma';
import { findSystemUser } from '@/lib/system-user';

import { errorResponse } from '@/lib/api-response';
export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const systemOwner = await findSystemUser(prisma);

  return NextResponse.json({ systemOwner });
}
