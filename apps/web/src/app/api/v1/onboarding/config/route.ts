import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { isUserAdmin } from '@/lib/auth-guards';
import { getSiteConfig } from '@/lib/site-config';
import { isSelfHosted } from '@/lib/self-hosted';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { buildEnvPresence } from './env-presence';
import { getAgentStatus } from '@/lib/agent-availability';

/**
 * GET /api/onboarding/config
 * Tells the welcome wizard how to behave: whether this is a self-hosted instance
 * (persist real choices) or the managed showcase (demo, no writes), whether the
 * signed-in user is the owner (may set server infrastructure), and the current
 * non-secret infra selection so the wizard can prefill it. No secrets returned.
 */
export async function GET(request: NextRequest) {
  try {
    const selfHosted = isSelfHosted();
    if (!selfHosted) {
      return NextResponse.json({ selfHosted: false, isOwner: false, infra: null, env: null });
    }

    const authed = await authenticateRequest(request);
    if (!authed) {
      return errorResponse('Unauthorized', 401);
    }

    const isOwner = await isUserAdmin(authed.userId);

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

    // Owner-only: which provider keys / storage env vars the server already has
    // (presence booleans, never values), so the wizard can pre-check them.
    const env = isOwner ? buildEnvPresence() : null;
    const agentStatuses = isOwner
      ? await Promise.all([getAgentStatus('claude-code'), getAgentStatus('codex')]).then(
          ([claude, codex]) => ({ 'claude-code': claude, codex })
        )
      : null;

    return NextResponse.json({
      selfHosted,
      isOwner,
      infra,
      env,
      ...(agentStatuses ? { agentStatuses } : {}),
    });
  } catch (error: unknown) {
    logger.error('Failed to load onboarding config', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to load onboarding config', 500);
  }
}
