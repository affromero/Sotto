import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { errorResponse } from '@/lib/api-response';
import { getTailscaleReachStatus, setupTailscaleServe } from '@/lib/tailscale-reach';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SOTTO_PORT = 3000;

function localHostFromRequest(request: NextRequest): boolean {
  const hostname = request.nextUrl.hostname.toLowerCase();
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return errorResponse('Unauthorized', 401);

  return NextResponse.json(await getTailscaleReachStatus(SOTTO_PORT));
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return errorResponse('Unauthorized', 401);
  if (session.user.role !== 'ADMIN') return errorResponse('Forbidden', 403);

  if (!localHostFromRequest(request)) {
    return errorResponse(
      'Tailscale setup can only be started from this Mac at http://localhost:3000/settings/devices.',
      403
    );
  }

  const result = await setupTailscaleServe(SOTTO_PORT);
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
