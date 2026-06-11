import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { requireAdmin } from '@/lib/auth-guards';
import { getSiteConfig } from '@/lib/site-config';
import { isSelfHosted } from '@/lib/self-hosted';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';

/**
 * GET /api/onboarding/config
 * Tells the welcome wizard how to behave: whether this is a self-hosted instance
 * (persist real choices) or the managed showcase (demo, no writes), whether the
 * signed-in user is the owner (may set server infrastructure), and the current
 * non-secret infra selection so the wizard can prefill it. No secrets returned.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse('Unauthorized', 401);
    }

    const selfHosted = isSelfHosted();
    const isOwner = selfHosted && (await requireAdmin()) !== null;

    const config = await getSiteConfig();
    const infra = isOwner
      ? {
          aiProvider: config.aiProvider,
          aiModel: config.aiModel,
          aiBaseUrl: config.aiBaseUrl,
          sttProvider: config.sttProvider,
          sttBaseUrl: config.sttBaseUrl,
          sttModel: config.sttModel,
          ttsProvider: config.ttsProvider,
          ttsBaseUrl: config.ttsBaseUrl,
          storageProvider: config.storageProvider,
          s3Bucket: config.s3Bucket,
          s3Region: config.s3Region,
        }
      : null;

    return NextResponse.json({ selfHosted, isOwner, infra });
  } catch (error: unknown) {
    logger.error('Failed to load onboarding config', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to load onboarding config', 500);
  }
}
