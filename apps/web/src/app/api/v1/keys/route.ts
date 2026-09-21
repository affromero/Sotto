import { listSottoKeys } from '@/lib/sidedoor/access/core/keys';
import { cookieValue, readAccessJson } from 'thesidedoor-core/access/http';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { SHARED_SESSION_COOKIE } from '@/lib/sidedoor/access/core/session-identity';
import { createSottoKey } from '@/lib/sidedoor/access/core/pairing';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { NextRequest, NextResponse } from 'next/server';
import { prismaUnfiltered } from '@/lib/prisma';
import { createApiKeySchema } from '@/lib/validations';

import { errorResponse } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  return accessOperation(request, false, async () => {
    const keys = await sottoTransaction(prismaUnfiltered, (database) =>
      listSottoKeys(database, request)
    );
    return NextResponse.json(keys);
  });
}

export async function POST(request: NextRequest) {
  return accessOperation(request, true, async () => {
    if (request.headers.has('authorization'))
      return errorResponse('Browser sign-in is required to create a key', 403);
    const token = cookieValue(request, SHARED_SESSION_COOKIE);
    if (!token) return errorResponse('Unauthorized', 401);
    const parsed = createApiKeySchema.safeParse(await readAccessJson(request));
    if (!parsed.success) return errorResponse(parsed.error.flatten(), 400);
    const created = await sottoTransaction(prismaUnfiltered, (database) =>
      createSottoKey(database, token, parsed.data.name)
    );
    return NextResponse.json(created, { status: 201 });
  });
}
