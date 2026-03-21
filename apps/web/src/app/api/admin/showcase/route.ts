import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { generateShowcaseStills, getShowcaseCostPreview } from '@/lib/showcase-generator';
import { z } from 'zod';

const generateSchema = z.object({
  imageModel: z.string().optional(),
}).optional();

/**
 * GET /api/admin/showcase — Preview which models/providers will be used and their costs.
 */
export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const preview = await getShowcaseCostPreview();
  return NextResponse.json(preview);
}

/**
 * POST /api/admin/showcase — Generate showcase stills for all visual types.
 * Returns URLs for each generated image.
 */
export async function POST(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json().catch(() => ({}));
  const parsed = generateSchema.safeParse(body);
  const imageModel = parsed.success ? parsed.data?.imageModel : undefined;

  const { items, failures } = await generateShowcaseStills({ imageModel });

  return NextResponse.json({
    count: items.length,
    items,
    ...(failures.length > 0 && { failures }),
  });
}
