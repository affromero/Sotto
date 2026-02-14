import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { onboardingInterestsSchema } from '@/lib/validations';
import { generateTagSlug } from '@/lib/slugify';

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validation = onboardingInterestsSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json({ error: validation.error.errors[0].message }, { status: 400 });
    }

    const { tagIds, customTags } = validation.data;
    const userId = session.user.id;

    // Enforce combined limit of 20
    if (tagIds.length + customTags.length > 20) {
      return NextResponse.json(
        { error: 'Maximum 20 interests allowed (predefined + custom combined)' },
        { status: 400 }
      );
    }

    // Verify all tag IDs exist and are sub-tags (have a parentId)
    if (tagIds.length > 0) {
      const existingTags = await prisma.tag.findMany({
        where: { id: { in: tagIds } },
        select: { id: true, parentId: true },
      });

      if (existingTags.length !== tagIds.length) {
        return NextResponse.json({ error: 'One or more tag IDs are invalid' }, { status: 400 });
      }

      const topLevelTags = existingTags.filter((t) => !t.parentId);
      if (topLevelTags.length > 0) {
        return NextResponse.json(
          { error: 'Only sub-interest tags can be selected, not top-level categories' },
          { status: 400 }
        );
      }
    }

    // Upsert custom tags and collect their IDs
    const customTagIds: string[] = [];
    if (customTags.length > 0) {
      // Resolve parent categories by slug
      const parentSlugs = [...new Set(customTags.map((ct) => ct.parentSlug))];
      const parents = await prisma.tag.findMany({
        where: { slug: { in: parentSlugs }, parentId: null },
        select: { id: true, slug: true },
      });
      const parentMap = new Map(parents.map((p) => [p.slug, p.id]));

      for (const ct of customTags) {
        const parentId = parentMap.get(ct.parentSlug);
        if (!parentId) {
          return NextResponse.json(
            { error: `Unknown parent category: ${ct.parentSlug}` },
            { status: 400 }
          );
        }

        const slug = generateTagSlug(ct.name);
        if (!slug) {
          return NextResponse.json(
            { error: `Invalid custom interest name: ${ct.name}` },
            { status: 400 }
          );
        }

        const tag = await prisma.tag.upsert({
          where: { slug },
          create: { name: ct.name, slug, parentId },
          update: {},
        });
        customTagIds.push(tag.id);
      }
    }

    const allTagIds = [...new Set([...tagIds, ...customTagIds])];

    // Upsert interests and mark onboarding complete in a transaction
    await prisma.$transaction(async (tx) => {
      // Delete existing onboarding interests
      await tx.userInterest.deleteMany({
        where: { userId, source: 'onboarding' },
      });

      // Create new interests
      if (allTagIds.length > 0) {
        await tx.userInterest.createMany({
          data: allTagIds.map((tagId) => ({
            userId,
            tagId,
            source: 'onboarding',
            weight: 1.0,
          })),
        });
      }

      // Mark onboarding as complete
      await tx.user.update({
        where: { id: userId },
        data: { hasCompletedOnboarding: true },
      });
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to save interests';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
