import { NextResponse } from 'next/server';
import { z } from 'zod';
import { PlaceResolver } from '@sotto/maps';

const resolveQuerySchema = z.object({
  q: z.string().min(1).max(200),
  year: z.coerce.number().int().min(-10000).max(2100).optional(),
});

const resolver = new PlaceResolver();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = resolveQuerySchema.safeParse({
    q: searchParams.get('q'),
    year: searchParams.get('year') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { q, year } = parsed.data;
  const place = year != null ? await resolver.resolveHistorical(q, year) : await resolver.resolve(q);

  if (!place) {
    return NextResponse.json({ error: `Place not found: ${q}` }, { status: 404 });
  }

  return NextResponse.json(place);
}
