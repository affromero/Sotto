import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { inspireDrillSchema } from '@/lib/validations';
import { drillDown } from '@/lib/inspire-engine';

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validation = inspireDrillSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json({ error: validation.error.errors[0].message }, { status: 400 });
    }

    const { category, parentTitle } = validation.data;
    const subtopics = await drillDown(session.user.id, category, parentTitle);

    return NextResponse.json({ subtopics });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to drill down';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
