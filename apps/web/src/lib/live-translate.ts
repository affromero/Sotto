// Gemini Live "Live conversation" backend: resolves the learner's BYOK Google key
// and mints a short-lived ephemeral token the browser uses to open a Live API
// WebSocket directly to Google. The BYOK key never reaches the client.
//
// No fallback: Live needs a real Google (Gemini) key, so there is no keyless
// backend and no provider-availability fallback here. When the learner has no
// Google key the feature is hidden (canLiveTranslate) and the route 422s with an
// actionable message. The Live model id is configurable via GEMINI_LIVE_MODEL.
import { GoogleGenAI, Modality } from '@google/genai';
import { getAiKey } from './byok';
import { prisma } from './prisma';

/** Default Gemini Live model. Override with GEMINI_LIVE_MODEL for a
 *  translation-tuned preview (half-cascade) model when your key has access. */
const DEFAULT_LIVE_MODEL = 'gemini-live-2.5-flash-preview';

/** Ephemeral tokens + Live API live on the v1alpha surface. */
const LIVE_API_VERSION = 'v1alpha';

/** Token lifetime; the browser must open the session before this passes. */
const TOKEN_TTL_MS = 30 * 60 * 1000;

export type LiveDirection = 'native_to_target' | 'target_to_native';

export interface LiveTranslateResolution {
  apiKey: string;
  model: string;
}

export interface LiveTokenResult {
  /** Ephemeral token string; the client passes it as its apiKey. */
  token: string;
  model: string;
  apiVersion: string;
  /** Language the learner hears (depends on direction). BCP-47 primary subtag. */
  targetLanguageCode: string;
  /** The learner's native language (their L1). */
  nativeLanguageCode: string;
  direction: LiveDirection;
  expiresAt: string;
}

/** No Google key on file. The feature is gated, not silently degraded. */
export class LiveTranslateKeyError extends Error {}
/** The course does not exist or is not owned by the caller. */
export class LiveTranslateCourseError extends Error {}
/** The key exists but Google rejected the Live/ephemeral-token request. */
export class LiveTranslateAccessError extends Error {}

export function getLiveTranslateModel(): string {
  const override = (process.env.GEMINI_LIVE_MODEL ?? '').trim();
  return override || DEFAULT_LIVE_MODEL;
}

/**
 * BYOK-google-only. Throws LiveTranslateKeyError when the learner has no Google
 * key (no keyless or availability fallback — Live requires a real cloud key).
 */
export async function resolveLiveTranslate(userId: string): Promise<LiveTranslateResolution> {
  const key = await getAiKey(userId, 'google');
  if (!key) {
    throw new LiveTranslateKeyError(
      'Live conversation needs a Google (Gemini) API key. Add one in Settings to unlock it.',
    );
  }
  return { apiKey: key.apiKey, model: getLiveTranslateModel() };
}

/**
 * Lightweight gate probe for the nav entry. Checks key presence without
 * decrypting or bumping lastUsedAt (unlike getAiKey), so it is cheap to call on
 * every /learn hub render.
 */
export async function canLiveTranslate(userId: string): Promise<boolean> {
  const row = await prisma.userAiKey.findUnique({
    where: { userId_provider: { userId, provider: 'google' } },
    select: { id: true },
  });
  return Boolean(row);
}

/**
 * Mints a single-use, short-TTL ephemeral token scoped to the Live model with the
 * learner's translation direction locked in. The browser opens the Live session
 * with `token` as its apiKey; the BYOK key stays server-side.
 */
export async function mintLiveToken(
  userId: string,
  courseId: string,
  direction: LiveDirection,
): Promise<LiveTokenResult> {
  const course = await prisma.course.findFirst({
    where: { id: courseId, userId },
    select: { nativeLang: true, targetLang: true },
  });
  if (!course) throw new LiveTranslateCourseError('Course not found');

  const { apiKey, model } = await resolveLiveTranslate(userId);

  // Which language the learner hears depends on which way they translate.
  const targetLanguageCode =
    direction === 'native_to_target' ? course.targetLang : course.nativeLang;
  const nativeLanguageCode = course.nativeLang;
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: LIVE_API_VERSION } });

  let token: string | undefined;
  try {
    const created = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: expiresAt,
        liveConnectConstraints: {
          model,
          config: {
            responseModalities: [Modality.AUDIO],
            translationConfig: { targetLanguageCode, echoTargetLanguage: false },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        },
      },
    });
    token = created.name ?? undefined;
  } catch (error: unknown) {
    throw new LiveTranslateAccessError(
      'Could not start a live session. Your Google key may not have access to the Gemini Live model. ' +
        (error instanceof Error ? error.message : String(error)),
    );
  }

  if (!token) {
    throw new LiveTranslateAccessError('Gemini did not return a live session token.');
  }

  return {
    token,
    model,
    apiVersion: LIVE_API_VERSION,
    targetLanguageCode,
    nativeLanguageCode,
    direction,
    expiresAt,
  };
}
