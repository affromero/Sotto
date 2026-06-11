import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/showcase — Return a random active showcase set for the landing page.
 * Public endpoint, no auth required.
 */
export async function GET() {
  const activeSets = await prisma.showcaseSet.findMany({
    where: { active: true },
    select: { id: true, name: true, items: true },
  });

  if (activeSets.length === 0) {
    return NextResponse.json({ items: [] });
  }

  // Pick one at random
  const set = activeSets[Math.floor(Math.random() * activeSets.length)];

  return NextResponse.json({
    id: set.id,
    name: set.name,
    items: set.items,
  });
}
