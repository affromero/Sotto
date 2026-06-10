import type { NotificationData } from '@/types/notification';

const PIPELINE_SUCCESS_TYPES = new Set([
  'PODCAST_READY',
  'SCRIPT_READY',
  'VIDEO_READY',
  'MUSIC_READY',
]);

const PIPELINE_ERROR_TYPES = new Set([
  'PODCAST_FAILED',
  'VIDEO_FAILED',
  'MUSIC_FAILED',
  'AVATAR_FAILED',
  'VOICE_TRACK_FAILED',
  'KEY_INVALID',
  'PIPELINE_FAILURE',
]);

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
  const podcastId = notification.data?.podcastId;
  switch (notification.type) {
    // Podcast-centric
    case 'PODCAST_READY':
    case 'PODCAST_FAILED':
    case 'SCRIPT_READY':
    case 'VIDEO_READY':
    case 'VIDEO_FAILED':
    case 'MUSIC_READY':
    case 'MUSIC_FAILED':
    case 'AVATAR_FAILED':
    case 'VOICE_TRACK_FAILED':
    case 'QUESTION_ON_YOUR_PODCAST':
    case 'CLAIM_REPORT_ON_YOUR_PODCAST':
    case 'RENDITION_PROPOSED':
    case 'RENDITION_ACCEPTED':
    case 'RENDITION_REJECTED':
      return podcastId ? `/podcast/${podcastId}` : null;

    // Settings / BYOK
    case 'KEY_INVALID':
      return '/billing';

    // Account moderation
    case 'ACCOUNT_WARNING':
    case 'ACCOUNT_SUSPENDED':
    case 'ACCOUNT_BANNED':
    case 'CONTENT_REMOVED':
      return '/settings';

    // Voice verification
    case 'VOICE_VERIFICATION_REQUIRED':
    case 'VOICE_VERIFICATION_PASSED':
    case 'VOICE_VERIFICATION_FAILED':
    case 'VOICE_BLOCKED_DUPLICATE':
    case 'VOICE_OWNERSHIP_ALERT':
      return '/settings/voices';

    // Pipeline failure (admin)
    case 'PIPELINE_FAILURE':
      return podcastId ? `/podcast/${podcastId}` : '/admin';

    // Referral
    case 'REFERRAL_SIGNUP':
      return '/settings';

    // Avatar images
    case 'AVATAR_IMAGE_REQUEST_RECEIVED':
    case 'AVATAR_IMAGE_REQUEST_APPROVED':
    case 'AVATAR_IMAGE_REQUEST_DENIED':
    case 'AVATAR_IMAGE_REQUEST_REVOKED':
      return '/settings';

    default:
      return null;
  }
}
