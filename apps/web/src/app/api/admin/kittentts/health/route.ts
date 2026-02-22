import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';

export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = process.env.KITTENTTS_URL;
  if (!url) return NextResponse.json({ configured: false, status: 'unconfigured' });

  const start = Date.now();
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
    const latencyMs = Date.now() - start;
    if (!res.ok) return NextResponse.json({ configured: true, status: 'loading', latencyMs });
    const data = (await res.json()) as { status: string; model?: string };
    return NextResponse.json({ configured: true, status: data.status, model: data.model, latencyMs });
  } catch {
    return NextResponse.json({ configured: true, status: 'unavailable', latencyMs: Date.now() - start });
  }
}
