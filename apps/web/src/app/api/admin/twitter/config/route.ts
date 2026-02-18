import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { getTwitterConfig, setTwitterConfig } from '@/lib/twitter-config';
import { twitterConfigUpdateSchema } from '@/lib/validations';

export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const config = await getTwitterConfig();
  return NextResponse.json(config);
}

export async function PATCH(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const parsed = twitterConfigUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await setTwitterConfig(parsed.data, adminId);
  const updated = await getTwitterConfig();
  return NextResponse.json(updated);
}
