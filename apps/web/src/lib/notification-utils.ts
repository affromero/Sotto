import type { NotificationData } from '@/types/notification';

const PIPELINE_SUCCESS_TYPES = new Set(['EPISODE_READY', 'SCRIPT_READY']);

const PIPELINE_ERROR_TYPES = new Set(['EPISODE_FAILED', 'KEY_INVALID', 'PIPELINE_FAILURE']);

export function isPipelineSuccessNotification(type: string): boolean {
  return PIPELINE_SUCCESS_TYPES.has(type);
}

export function isErrorNotification(type: string): boolean {
  return PIPELINE_ERROR_TYPES.has(type);
}

export function isPipelineNotification(type: string): boolean {
  return PIPELINE_SUCCESS_TYPES.has(type) || PIPELINE_ERROR_TYPES.has(type);
}

/**
 * Build a URL to navigate to based on notification type and data.
 * Returns null if no meaningful navigation target exists.
 */
export function getNotificationUrl(notification: NotificationData): string | null {
  const episodeId = notification.data?.episodeId;
  switch (notification.type) {
    // Episode-centric
    case 'EPISODE_READY':
    case 'EPISODE_FAILED':
    case 'SCRIPT_READY':
      return episodeId ? `/episode/${episodeId}` : null;

    // Settings / BYOK
    case 'KEY_INVALID':
      return '/settings';

    // Pipeline failure (admin)
    case 'PIPELINE_FAILURE':
      return episodeId ? `/episode/${episodeId}` : '/admin';

    default:
      return null;
  }
}
