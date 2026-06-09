import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/**
 * Household members — owner-facing roster of every learner on this instance.
 *
 * GET (ADMIN only): returns each non-SYSTEM user with a course count and an
 * `isOwner` flag (role === 'ADMIN'). Each member is a fully isolated learner;
 * this endpoint intentionally exposes no social/relationship data.
 */
export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const users = await prisma.user.findMany({
    where: { role: { not: 'SYSTEM' } },
    orderBy: [{ role: 'desc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      role: true,
      createdAt: true,
      _count: { select: { courses: true } },
    },
  });

  const members = users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    courseCount: user._count.courses,
    isOwner: user.role === 'ADMIN',
  }));

  return NextResponse.json({ members });
}
