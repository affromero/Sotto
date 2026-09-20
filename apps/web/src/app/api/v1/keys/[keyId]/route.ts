import { NextRequest, NextResponse } from 'next/server';
import { prismaUnfiltered } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { revokeSottoKey } from '@/lib/sidedoor/access/core/keys';

type RouteParams = { params: Promise<{ keyId: string }> };

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return accessOperation(request, !request.headers.has('authorization'), async () => {
    const { keyId } = await params;
    const found = await sottoTransaction(prismaUnfiltered, (database) =>
      revokeSottoKey(database, request, keyId)
    );
    if (!found) return errorResponse('API key not found', 404);
    return new NextResponse(null, { status: 204 });
  });
}
