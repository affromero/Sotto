import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth-guards';
import { createMember, updateMember, removeMember } from '@/lib/local-account';
import { createMemberSchema, updateMemberSchema } from '@/lib/validations';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
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

/** POST (ADMIN): add a member with a temporary password they must change. */
export async function POST(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const parsed = createMemberSchema.safeParse(await request.json());
  if (!parsed.success) return errorResponse(parsed.error.errors[0].message, 400);

  try {
    const { id } = await createMember(parsed.data);
    return NextResponse.json({ memberId: id }, { status: 201 });
  } catch (error: unknown) {
    logger.error('Failed to create member', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to create member', 500);
  }
}

/** PATCH (ADMIN): rename, re-avatar, or reset a member's password. */
export async function PATCH(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const parsed = updateMemberSchema.safeParse(await request.json());
  if (!parsed.success) return errorResponse(parsed.error.errors[0].message, 400);
  if (parsed.data.memberId === adminId) {
    return errorResponse('Use account settings to change your own profile', 400);
  }

  const target = await prisma.user.findUnique({
    where: { id: parsed.data.memberId },
    select: { id: true },
  });
  if (!target) return errorResponse('Member not found', 404);

  await updateMember(parsed.data);
  return NextResponse.json({ ok: true });
}

/** DELETE (ADMIN): remove a member and revoke their active sessions. */
export async function DELETE(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const body = (await request.json().catch(() => ({}))) as { memberId?: unknown };
  const memberId = typeof body.memberId === 'string' ? body.memberId : '';
  if (!memberId) return errorResponse('memberId is required', 400);
  if (memberId === adminId) return errorResponse('You cannot remove yourself', 400);

  const target = await prisma.user.findUnique({
    where: { id: memberId },
    select: { role: true },
  });
  if (!target) return errorResponse('Member not found', 404);
  if (target.role === 'ADMIN') return errorResponse('An admin cannot be removed here', 400);

  await removeMember(memberId);
  return NextResponse.json({ ok: true });
}
