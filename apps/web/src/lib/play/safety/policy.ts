import {
  PLAY_CONDUCT_PARAGRAPHS,
  PLAY_CONDUCT_TITLE,
  PLAY_CONDUCT_VERSION,
  PLAY_SAFETY_HTTP_STATUS,
  playSafetyPolicySchema,
  type PlayRoomView,
} from '@sotto/shared';
import { containsBlockedModerationTerm, looksLikeSottoImpersonation } from '@/lib/local-moderation';
import { privacyContactUrl } from '@/lib/privacy/contact';

export class PlaySafetyError extends Error {
  constructor(
    readonly reason: keyof typeof PLAY_SAFETY_HTTP_STATUS,
    message: string
  ) {
    super(message);
    this.name = 'PlaySafetyError';
  }
}

export function playSafetyContactUrl(input: string | undefined): string | null {
  const validated = privacyContactUrl(input);
  if (!validated) return null;
  const url = new URL(validated);
  url.searchParams.set('subject', 'Sotto game safety');
  return url.toString();
}

export function readPlaySafetyPolicy() {
  return playSafetyPolicySchema.parse({
    version: PLAY_CONDUCT_VERSION,
    title: PLAY_CONDUCT_TITLE,
    paragraphs: PLAY_CONDUCT_PARAGRAPHS,
    operatorContactUrl: playSafetyContactUrl(process.env.SOTTO_PRIVACY_CONTACT_EMAIL),
    termsPath: '/terms',
    privacyPath: '/privacy',
    reviewPath: '/play/safety/review',
  });
}

export function assertPlaySharedTextAllowed(text: string) {
  if (containsBlockedModerationTerm(text))
    throw new PlaySafetyError(
      'TEXT_FILTERED',
      'Choose different wording before sharing this text.'
    );
}

export function assertPlayDisplayNameAllowed(text: string) {
  assertPlaySharedTextAllowed(text);
  if (looksLikeSottoImpersonation(text))
    throw new PlaySafetyError(
      'TEXT_FILTERED',
      'Choose a name that does not impersonate Sotto staff.'
    );
}

export function redactPlayPublishedName(value: string | null | undefined, fallback = 'Player') {
  const name = value ?? fallback;
  return containsBlockedModerationTerm(name) || looksLikeSottoImpersonation(name)
    ? 'Name hidden'
    : name;
}

export function redactPlayRoomNames(view: PlayRoomView): PlayRoomView {
  return {
    ...view,
    host: { ...view.host, name: redactPlayPublishedName(view.host.name) },
    guest: view.guest ? { ...view.guest, name: redactPlayPublishedName(view.guest.name) } : null,
  };
}
