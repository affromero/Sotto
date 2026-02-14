import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDailyPicks } from '@/lib/recommendation-engine';

/**
 * GET /api/picks — Get daily picks for authenticated user.
 * POST /api/picks — Refresh picks (generates new batch).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await getDailyPicks(session.user.id);
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { refreshBatch?: number } = {};
  try {
    body = await request.json();
  } catch {
    // Empty body is fine
  }

  const refreshBatch = (body.refreshBatch ?? 0) + 1;
  const result = await getDailyPicks(session.user.id, refreshBatch);
  return NextResponse.json(result);
}
