import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { generateShowcaseStills } from '@/lib/showcase-generator';

/**
 * POST /api/admin/showcase — Generate showcase stills for all visual types.
 * Returns URLs for each generated image.
 */
export async function POST() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const { items, failures } = await generateShowcaseStills();

  return NextResponse.json({
    count: items.length,
    items,
    ...(failures.length > 0 && { failures }),
  });
}
