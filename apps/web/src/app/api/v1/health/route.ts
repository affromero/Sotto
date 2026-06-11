import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getHealthData } from '@/lib/health';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  const isAdmin = session?.user?.role === 'ADMIN';
  const data = await getHealthData(isAdmin);
  return NextResponse.json(data, { status: data.status === 'healthy' ? 200 : 503 });
}
