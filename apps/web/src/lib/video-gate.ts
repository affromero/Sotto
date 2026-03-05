import { prisma } from './prisma';

export type VideoGateReason = 'ok' | 'upgrade_to_pro' | 'no_image_provider';

export interface VideoGateResult {
  allowed: boolean;
  reason: VideoGateReason;
}

/**
 * Check if a user can generate video.
 * PRO or ADMIN/SYSTEM users are allowed.
 * FREE users are denied with an upgrade prompt.
 */
export async function checkVideoGenerationGate(userId: string): Promise<VideoGateResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, role: true },
  });

  if (!user) {
    return { allowed: false, reason: 'upgrade_to_pro' };
  }

  const isPrivileged = user.role === 'ADMIN' || user.role === 'SYSTEM';
  const isProUser = user.plan === 'PRO';

  if (!isProUser && !isPrivileged) {
    return { allowed: false, reason: 'upgrade_to_pro' };
  }

  // Check that fal key is available (BYOK or platform FAL_KEY)
  if (!process.env.FAL_KEY) {
    const byokKey = await prisma.userTtsKey.findFirst({
      where: { userId, provider: 'fal', isValid: true },
      select: { id: true },
    });

    if (!byokKey) {
      return { allowed: false, reason: 'no_image_provider' };
    }
  }

  return { allowed: true, reason: 'ok' };
}
