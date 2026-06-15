import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { createProfile } from '@/lib/local-user';
import { getHouseholdProfiles } from '@/lib/profiles';
import { resolveProfileAvatar } from '@/lib/avatars';
import { createProfileSchema } from '@/lib/validations';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';

/** List every profile in the household (owner first), flagging the active one. */
export async function GET(request: NextRequest) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);

    const profiles = await getHouseholdProfiles();
    return NextResponse.json({
      profiles: profiles.map((p) => ({ ...p, isActive: p.id === authed.userId })),
    });
  } catch (error: unknown) {
    logger.error('Failed to list profiles', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to list profiles', 500);
  }
}

/** Add a new learner profile to the household (always a regular USER). */
export async function POST(request: NextRequest) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);

    const body = await request.json();
    const validation = createProfileSchema.safeParse(body);
    if (!validation.success) {
      return errorResponse(validation.error.issues[0].message, 400);
    }

    const user = await createProfile({
      name: validation.data.name,
      avatarSlug: validation.data.avatarSlug,
    });

    return NextResponse.json(
      {
        id: user.id,
        name: user.name,
        avatarUrl: resolveProfileAvatar(user.id, user.image).image,
        isOwner: false,
        role: user.role,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    logger.error('Failed to create profile', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to create profile', 500);
  }
}
