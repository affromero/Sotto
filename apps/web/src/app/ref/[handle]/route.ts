import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ handle: string }> }
) {
  const { handle } = await params;

  const user = await prisma.user.findFirst({
    where: { handle: handle.toLowerCase() },
    select: { id: true },
  });

  const response = NextResponse.redirect(new URL('/auth/signup', request.url));

  if (user) {
    response.cookies.set('sotto_ref', handle.toLowerCase(), {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: '/',
    });
  }

  return response;
}
