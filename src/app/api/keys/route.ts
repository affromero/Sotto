import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { generateApiKey } from '@/lib/api-keys';
import { createApiKeySchema } from '@/lib/validations';
import { getUserTier } from '@/lib/subscription';

const MAX_ACTIVE_KEYS = 10;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const keys = await prisma.apiKey.findMany({
    where: { userId: session.user.id },
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
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Only TEAM tier can create API keys
  const tier = await getUserTier(session.user.id);
  if (tier !== 'CREATOR') {
    return NextResponse.json(
      { error: 'API keys require a Creator subscription' },
      { status: 403 }
    );
  }

  const body = await request.json();
  const parsed = createApiKeySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Check active key limit
  const activeCount = await prisma.apiKey.count({
    where: { userId: session.user.id, revokedAt: null },
  });

  if (activeCount >= MAX_ACTIVE_KEYS) {
    return NextResponse.json(
      { error: `Maximum of ${MAX_ACTIVE_KEYS} active API keys allowed` },
      { status: 400 }
    );
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
