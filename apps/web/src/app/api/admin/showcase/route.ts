import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { generateShowcaseClips, getShowcaseCostPreview, regenerateShowcaseItem, type ShowcaseItem } from '@/lib/showcase-generator';
import { prisma } from '@/lib/prisma';
import { isValidModelId } from '@/lib/providers/ai-registry';
import { z } from 'zod';

const generateSchema = z.object({
  name: z.string().min(1).max(100),
  aiModel: z.string().min(1).max(100),
  imageModel: z.string().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  active: z.boolean().optional(),
});

/**
 * GET /api/admin/showcase — List all showcase sets + cost preview.
 */
export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  try {
    const sets = await prisma.showcaseSet.findMany({
      orderBy: { createdAt: 'desc' },
    });

    let costPreview = null;
    try {
      costPreview = await getShowcaseCostPreview();
    } catch (err) {
      console.error('[showcase GET] costPreview failed:', (err as Error).message);
    }

    return NextResponse.json({ sets, costPreview });
  } catch (err) {
    console.error('[showcase GET] fatal:', err);
    return errorResponse((err as Error).message, 500);
  }
}

/**
 * POST /api/admin/showcase — Generate a new showcase set and save it.
 */
export async function POST(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const body = await request.json().catch(() => ({}));
  const parsed = generateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0].message, 400, { errors: parsed.error.flatten() });
  }

  const { name, aiModel, imageModel } = parsed.data;
  if (!isValidModelId(aiModel)) {
    return errorResponse(`Unknown AI model: "${aiModel}"`, 400);
  }
  const { items, failures } = await generateShowcaseClips({ aiModel, imageModel, topic: name });

  // New set is active by default — deactivate others
  await prisma.showcaseSet.updateMany({
    where: { active: true },
    data: { active: false },
  });

  const set = await prisma.showcaseSet.create({
    data: {
      name,
      active: true,
      items: JSON.parse(JSON.stringify(items)),
    },
  });

  return NextResponse.json({
    set,
    failures: failures.length > 0 ? failures : undefined,
  });
}

/**
 * PATCH /api/admin/showcase — Update a showcase set.
 * Supports: rename, toggle active, or regenerate a single visual type.
 *
 * Body: { id, name?, active?, regenerateType?: string, imageModel?: string }
 */
export async function PATCH(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const body = await request.json().catch(() => ({}));
  const id = body?.id as string;
  if (!id) return errorResponse('id is required', 400);

  // Regenerate all items — single LLM call, render all clips
  if (body?.regenerateAll) {
    const existing = await prisma.showcaseSet.findUnique({ where: { id } });
    if (!existing) return errorResponse('Set not found', 404);

    const aiModel = typeof body?.aiModel === 'string' ? body.aiModel : null;
    if (!aiModel) return errorResponse('aiModel is required for showcase regeneration', 400);
    if (!isValidModelId(aiModel)) return errorResponse(`Unknown AI model: "${aiModel}"`, 400);

    const { items: newItems, failures } = await generateShowcaseClips({ aiModel, imageModel: body?.imageModel, topic: existing.name });

    const set = await prisma.showcaseSet.update({
      where: { id },
      data: { items: JSON.parse(JSON.stringify(newItems)) },
    });

    return NextResponse.json({ set, regenerated: 'all', failures: failures.length > 0 ? failures : undefined });
  }

  // Single-item regeneration
  const regenerateType = body?.regenerateType as string | undefined;
  if (regenerateType) {
    const existing = await prisma.showcaseSet.findUnique({ where: { id } });
    if (!existing) return errorResponse('Set not found', 404);

    const aiModel = typeof body?.aiModel === 'string' ? body.aiModel : null;
    if (!aiModel) return errorResponse('aiModel is required for showcase regeneration', 400);
    if (!isValidModelId(aiModel)) return errorResponse(`Unknown AI model: "${aiModel}"`, 400);

    const newItem = await regenerateShowcaseItem(regenerateType, { aiModel, imageModel: body?.imageModel, topic: existing.name });
    const items = (existing.items as unknown as ShowcaseItem[]).map((item) =>
      item.visualType === regenerateType ? newItem : item,
    );

    const set = await prisma.showcaseSet.update({
      where: { id },
      data: { items: JSON.parse(JSON.stringify(items)) },
    });

    return NextResponse.json({ set, regenerated: regenerateType });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('Invalid request', 400, { errors: parsed.error.flatten() });
  }

  // If setting active, deactivate all others first
  if (parsed.data.active) {
    await prisma.showcaseSet.updateMany({
      where: { active: true },
      data: { active: false },
    });
  }

  const set = await prisma.showcaseSet.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.active !== undefined && { active: parsed.data.active }),
    },
  });

  return NextResponse.json({ set });
}

/**
 * DELETE /api/admin/showcase — Delete a showcase set.
 */
export async function DELETE(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const { searchParams } = request.nextUrl;
  const id = searchParams.get('id');
  if (!id) return errorResponse('id query param required', 400);

  await prisma.showcaseSet.delete({ where: { id } });
  return NextResponse.json({ deleted: true });
}
