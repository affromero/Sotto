import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
export async function GET() {
  const session = await auth();

  if (!session?.user) {
    return errorResponse('Unauthorized', 401);
  }

  const userRole = (session.user as Record<string, unknown>)?.role as string;

  if (userRole !== 'ADMIN') {
    return errorResponse('Forbidden', 403);
  }

  try {
    const entries = await prisma.waitlist.findMany({
      orderBy: { createdAt: 'desc' },
    });

    const csv = [
      'Email,Twitter,Source,Status,Signed Up,Approved At,Converted At',
      ...entries.map((entry) =>
        [
          entry.email,
          entry.twitterHandle ?? '',
          entry.source ?? 'unknown',
          entry.status,
          new Date(entry.createdAt).toISOString(),
          entry.approvedAt ? new Date(entry.approvedAt).toISOString() : '',
          entry.signedUpAt ? new Date(entry.signedUpAt).toISOString() : '',
        ].join(',')
      ),
    ].join('\n');

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="waitlist-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
  } catch (error) {
    console.error('Error exporting waitlist:', error);
    return errorResponse('Failed to export waitlist', 500);
  }
}
