import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getHealthData } from '@/lib/health';

export const dynamic = 'force-dynamic';

let publicHealthCache: { expiresAt: number; value: ReturnType<typeof getHealthData> } | null = null;

export async function GET() {
  const session = await auth();
  const isAdmin = session?.user?.role === 'ADMIN';
  let value: ReturnType<typeof getHealthData>;
  if (isAdmin || process.env.NODE_ENV !== 'production') {
    value = getHealthData(isAdmin);
  } else if (publicHealthCache && publicHealthCache.expiresAt > Date.now()) {
    value = publicHealthCache.value;
  } else {
    value = getHealthData(false);
    publicHealthCache = { expiresAt: Date.now() + 5000, value };
  }
  const data = await value;
  return NextResponse.json(data, { status: data.status === 'healthy' ? 200 : 503 });
}
