import { NextRequest, NextResponse } from 'next/server';
import { GET as readPrelude } from '../route';
import { preparePrerequisiteHttp } from '@/lib/classes/help/prerequisite-http';

type Params = { params: Promise<{ classId: string }> };

/** Reuse the fenced admission and return only the current pre-practice projection. */
export async function POST(request: NextRequest, params: Params) {
  const admission = await preparePrerequisiteHttp(request, params, true);
  if (!admission.ok) return admission;
  const prelude = await readPrelude(request, params);
  if (!prelude.ok) return prelude;
  return NextResponse.json(await prelude.json(), {
    status: admission.status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
