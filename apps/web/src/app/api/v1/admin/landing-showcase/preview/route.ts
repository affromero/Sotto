import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { landingShowcaseUpdateSchema } from '@/lib/validations';
import { buildShowcaseData } from '@/lib/showcase';
import { errorResponse } from '@/lib/api-response';

/**
 * POST /api/admin/landing-showcase/preview
 * Returns LandingShowcaseData for a given config without saving to DB.
 * Used by the admin dashboard to preview changes before saving.
 */
export async function POST(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json();
  const parsed = landingShowcaseUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const config = {
    podcastId: parsed.data.podcastId,
    scriptTurnStart: parsed.data.scriptTurnStart ?? 0,
    scriptTurnCount: parsed.data.scriptTurnCount ?? 2,
    audioClipStart: parsed.data.audioClipStart ?? 0,
    audioClipEnd: parsed.data.audioClipEnd ?? null,
    videoSegmentStart: parsed.data.videoSegmentStart ?? 0,
    videoSegmentCount: parsed.data.videoSegmentCount ?? 4,
    showAvatar: parsed.data.showAvatar ?? false,
    showVideo: parsed.data.showVideo ?? false,
  };

  const data = await buildShowcaseData(config);
  if (!data) {
    return errorResponse('Podcast not found or missing required data', 404);
  }

  return NextResponse.json({ data });
}
