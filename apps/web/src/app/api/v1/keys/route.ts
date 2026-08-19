import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, generateApiKey } from '@/lib/api-keys';
import { isUserAdmin } from '@/lib/auth-guards';
import { createApiKeySchema } from '@/lib/validations';

import { errorResponse } from '@/lib/api-response';
const MAX_ACTIVE_KEYS = 10;

// Listing and revoking are Bearer-capable so a paired device can audit and cut
// off its own credentials. Minting (POST, below) deliberately is NOT: ApiKey
// has no scopes and no expiry, so a stolen device key that could mint more
// would survive revoking the device it came from, defeating per-device
// revocation. New devices go through the pairing flow instead.
export async function GET(request: NextRequest) {
  const authed = await authenticateRequest(request);
  if (!authed) {
    return errorResponse('Unauthorized', 401);
  }
  if (!(await isUserAdmin(authed.userId))) {
    return errorResponse('Forbidden', 403);
  }

  const keys = await prisma.apiKey.findMany({
    where: { userId: authed.userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      lastUsedAt: true,
      createdAt: true,
      revokedAt: true,
    },
  });

  return NextResponse.json(keys);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }
  if (session.user.role !== 'ADMIN') {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json();
  const parsed = createApiKeySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  // Check active key limit
  const activeCount = await prisma.apiKey.count({
    where: { userId: session.user.id, revokedAt: null },
  });

  if (activeCount >= MAX_ACTIVE_KEYS) {
    return errorResponse(`Maximum of ${MAX_ACTIVE_KEYS} active API keys allowed`, 400);
  }

  const { key, hash, prefix } = generateApiKey();

  const apiKey = await prisma.apiKey.create({
    data: {
      userId: session.user.id,
      name: parsed.data.name,
      keyHash: hash,
      keyPrefix: prefix,
    },
  });

  return NextResponse.json(
    {
      id: apiKey.id,
      name: apiKey.name,
      key, // Full key shown only once
      keyPrefix: prefix,
      createdAt: apiKey.createdAt.toISOString(),
    },
    { status: 201 }
  );
}
