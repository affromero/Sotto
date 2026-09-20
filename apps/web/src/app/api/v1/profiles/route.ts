import { NextRequest, NextResponse } from 'next/server';
import { readAccessJson } from 'thesidedoor-core/access/http';
import { prismaUnfiltered } from '@/lib/prisma';
import { getHouseholdProfiles } from '@/lib/profiles';
import { createProfileSchema } from '@/lib/validations';
import { errorResponse } from '@/lib/api-response';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { prepareSottoProfile, createSottoProfile } from '@/lib/sidedoor/access/core/profiles';

export async function GET(request: NextRequest) {
  return accessOperation(request, false, async () =>
    NextResponse.json({ profiles: await getHouseholdProfiles(request) })
  );
}

export async function POST(request: NextRequest) {
  return accessOperation(request, !request.headers.has('authorization'), async () => {
    const parsed = createProfileSchema.safeParse(await readAccessJson(request));
    if (!parsed.success) return errorResponse(parsed.error.flatten(), 400);
    const prepared = prepareSottoProfile(parsed.data.name);
    const profile = await sottoTransaction(prismaUnfiltered, (database) =>
      createSottoProfile(database, request, prepared, parsed.data.avatarSlug)
    );
    return NextResponse.json(profile, { status: 201 });
  });
}
