import { prisma } from './prisma';
import { assertStorageWritable, uploadFile } from './r2';
import { getAutoModelConfig } from './auto-model-config';
import { getConfiguredTtsProviderId, resolveTtsProvider } from './providers/tts';
import { isValidProviderId, type TtsProviderId } from './providers/tts-registry';
import { getVisualCueKey } from './visual-cue-keys';
import { logger } from './logger';
import type { CefrLevel, FocusTargetKind, FocusTargetSource } from '@sotto/shared';

const MAX_TARGET_TEXT = 500;
const MAX_CONTEXT_TEXT = 2000;
const DEFAULT_DIFFICULTY = 3;
const MIN_DIFFICULTY = 1;
const MAX_DIFFICULTY = 5;
const SENTENCE_WORD_THRESHOLD = 6;

export class LearningTargetCourseNotFoundError extends Error {}
export class LearningTargetNotFoundError extends Error {}
export class LearningTargetUnavailableError extends Error {}

interface CourseContext {
  id: string;
  userId: string;
  nativeLang: string;
  targetLang: string;
  currentLevel: CefrLevel;
}

export interface LearningTargetInput {
  text: string;
  kind?: FocusTargetKind;
  contextText?: string | null;
  sourceType?: FocusTargetSource;
  sourceId?: string | null;
  sourceLabel?: string | null;
  userMarkedDifficulty?: number;
}

export interface LearningTargetDto {
  id: string;
  courseId: string;
  kind: FocusTargetKind;
  text: string;
  normalizedText: string;
  contextText: string | null;
  sourceType: FocusTargetSource;
  sourceId: string | null;
  sourceLabel: string | null;
  userMarkedDifficulty: number;
  priorityBoost: number;
  visualCueUrl: string | null;
  visualCueAlt: string | null;
  visualCueAttribution: string | null;
  visualCueProvider: string | null;
  pronunciationAudioUrl: string | null;
  lastSelectedAt: string;
  lastPracticedAt: string | null;
}

export interface FocusPracticeTarget {
  id: string;
  kind: FocusTargetKind;
  text: string;
  normalizedText: string;
  contextText: string | null;
  priorityBoost: number;
}

interface VisualCueResult {
  imageUrl: string;
  alt: string;
  attribution: string;
  provider: string;
}

function cleanText(value: string, max: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function normalizeLearningTargetText(value: string): string {
  return cleanText(value.normalize('NFKC').toLowerCase(), MAX_TARGET_TEXT);
}

export function inferFocusTargetKind(text: string): FocusTargetKind {
  const cleaned = cleanText(text, MAX_TARGET_TEXT);
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (/[.!?。！？]$/.test(cleaned) || words.length >= SENTENCE_WORD_THRESHOLD) return 'SENTENCE';
  if (words.length > 1) return 'PHRASE';
  return 'WORD';
}

function difficultyToPriorityBoost(difficulty: number): number {
  const clamped = Math.max(MIN_DIFFICULTY, Math.min(MAX_DIFFICULTY, Math.round(difficulty)));
  return 0.15 + clamped * 0.08;
}

function toDto(target: {
  id: string;
  courseId: string;
  kind: FocusTargetKind;
  text: string;
  normalizedText: string;
  contextText: string | null;
  sourceType: FocusTargetSource;
  sourceId: string | null;
  sourceLabel: string | null;
  userMarkedDifficulty: number;
  priorityBoost: number;
  visualCueUrl: string | null;
  visualCueAlt: string | null;
  visualCueAttribution: string | null;
  visualCueProvider: string | null;
  pronunciationAudioUrl: string | null;
  lastSelectedAt: Date;
  lastPracticedAt: Date | null;
}): LearningTargetDto {
  return {
    ...target,
    lastSelectedAt: target.lastSelectedAt.toISOString(),
    lastPracticedAt: target.lastPracticedAt?.toISOString() ?? null,
  };
}

async function loadOwnedCourse(courseId: string, userId: string): Promise<CourseContext> {
  const course = await prisma.course.findFirst({
    where: { id: courseId, userId },
    select: {
      id: true,
      userId: true,
      nativeLang: true,
      targetLang: true,
      currentLevel: true,
    },
  });
  if (!course) throw new LearningTargetCourseNotFoundError('Course not found');
  return course;
}

async function ensureVocabForTarget(
  course: CourseContext,
  target: LearningTargetInput & { kind: FocusTargetKind }
) {
  if (target.kind === 'SENTENCE') return;
  const lemma = cleanText(target.text, MAX_TARGET_TEXT);
  if (!lemma) return;
  const now = new Date();
  await prisma.learnerVocab.upsert({
    where: { courseId_lemma: { courseId: course.id, lemma } },
    create: {
      courseId: course.id,
      lemma,
      translation: '',
      partOfSpeech: target.kind === 'PHRASE' ? 'phrase' : null,
      firstSeenClassId: null,
      cefrLevel: course.currentLevel,
      dueAt: now,
      mastery: 0.05,
    },
    update: {
      dueAt: now,
    },
  });
}

export async function addLearningTarget(
  courseId: string,
  userId: string,
  input: LearningTargetInput
): Promise<LearningTargetDto> {
  const course = await loadOwnedCourse(courseId, userId);
  const text = cleanText(input.text, MAX_TARGET_TEXT);
  if (!text) throw new LearningTargetUnavailableError('Selection is empty');

  const kind = input.kind ?? inferFocusTargetKind(text);
  const normalizedText = normalizeLearningTargetText(text);
  const contextText = input.contextText ? cleanText(input.contextText, MAX_CONTEXT_TEXT) : null;
  const userMarkedDifficulty = Math.max(
    MIN_DIFFICULTY,
    Math.min(MAX_DIFFICULTY, Math.round(input.userMarkedDifficulty ?? DEFAULT_DIFFICULTY))
  );
  const sourceType = input.sourceType ?? 'MANUAL';
  const priorityBoost = difficultyToPriorityBoost(userMarkedDifficulty);
  const now = new Date();

  await ensureVocabForTarget(course, { ...input, text, kind });

  const target = await prisma.learnerFocusTarget.upsert({
    where: { courseId_kind_normalizedText: { courseId, kind, normalizedText } },
    create: {
      courseId,
      kind,
      text,
      normalizedText,
      contextText,
      sourceType,
      sourceId: input.sourceId ?? null,
      sourceLabel: input.sourceLabel ?? null,
      userMarkedDifficulty,
      priorityBoost,
      lastSelectedAt: now,
    },
    update: {
      text,
      contextText,
      sourceType,
      sourceId: input.sourceId ?? null,
      sourceLabel: input.sourceLabel ?? null,
      userMarkedDifficulty,
      priorityBoost,
      lastSelectedAt: now,
    },
  });

  return toDto(target);
}

export async function listLearningTargets(
  courseId: string,
  userId: string,
  limit = 30
): Promise<LearningTargetDto[]> {
  await loadOwnedCourse(courseId, userId);
  const targets = await prisma.learnerFocusTarget.findMany({
    where: { courseId },
    orderBy: [{ lastSelectedAt: 'desc' }],
    take: Math.max(1, Math.min(100, limit)),
  });
  return targets.map(toDto);
}

export async function getPracticeFocusTargets(
  courseId: string,
  limit = 4,
  focusTargetId?: string | null
): Promise<FocusPracticeTarget[]> {
  const where = focusTargetId ? { courseId, id: focusTargetId } : { courseId };
  const targets = await prisma.learnerFocusTarget.findMany({
    where,
    orderBy: [{ priorityBoost: 'desc' }, { lastSelectedAt: 'desc' }],
    take: focusTargetId ? 1 : Math.max(1, Math.min(8, limit)),
    select: {
      id: true,
      kind: true,
      text: true,
      normalizedText: true,
      contextText: true,
      priorityBoost: true,
    },
  });
  return targets;
}

export async function markFocusTargetsPracticed(
  courseId: string,
  focusTargetIds: string[],
  quality: number,
  now: Date
): Promise<void> {
  const ids = [...new Set(focusTargetIds.filter(Boolean))];
  if (ids.length === 0) return;
  const clamped = Math.max(0, Math.min(1, quality));
  const priorityBoost = clamped >= 0.7 ? 0.12 : Math.min(0.65, 0.35 + (1 - clamped) * 0.3);
  await prisma.learnerFocusTarget.updateMany({
    where: { courseId, id: { in: ids } },
    data: { lastPracticedAt: now, priorityBoost },
  });
}

async function findTargetForUser(courseId: string, userId: string, targetId: string) {
  await loadOwnedCourse(courseId, userId);
  const target = await prisma.learnerFocusTarget.findFirst({
    where: { id: targetId, courseId },
    include: {
      course: {
        select: {
          userId: true,
          targetLang: true,
          user: {
            select: {
              preferredTtsProvider: true,
              preferredTtsModel: true,
              preferredSttModel: true,
            },
          },
        },
      },
    },
  });
  if (!target || target.course.userId !== userId) {
    throw new LearningTargetNotFoundError('Learning target not found');
  }
  return target;
}

async function fetchPexelsCue(userId: string, query: string): Promise<VisualCueResult | null> {
  const apiKey = (await getVisualCueKey(userId, 'pexels')) ?? process.env.PEXELS_API_KEY?.trim();
  if (!apiKey) return null;

  const url = new URL('https://api.pexels.com/v1/search');
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', '1');
  url.searchParams.set('orientation', 'landscape');

  const response = await fetch(url, {
    headers: { Authorization: apiKey },
    cache: 'no-store',
  });
  if (!response.ok) return null;
  const body = (await response.json()) as {
    photos?: Array<{
      alt?: string;
      photographer?: string;
      photographer_url?: string;
      src?: { medium?: string; large?: string; landscape?: string };
    }>;
  };
  const photo = body.photos?.[0];
  const imageUrl = photo?.src?.landscape ?? photo?.src?.large ?? photo?.src?.medium;
  if (!photo || !imageUrl) return null;
  const photographer = photo.photographer?.trim() || 'Pexels';
  const photographerUrl = photo.photographer_url?.trim();
  return {
    imageUrl,
    alt: photo.alt?.trim() || query,
    attribution: photographerUrl ? `${photographer} (${photographerUrl})` : photographer,
    provider: 'pexels',
  };
}

export async function addVisualCue(
  courseId: string,
  userId: string,
  targetId: string
): Promise<LearningTargetDto> {
  const target = await findTargetForUser(courseId, userId, targetId);
  const cue = await fetchPexelsCue(userId, target.text);
  if (!cue) throw new LearningTargetUnavailableError('Visual cue provider is not configured');
  const updated = await prisma.learnerFocusTarget.update({
    where: { id: target.id },
    data: {
      visualCueUrl: cue.imageUrl,
      visualCueAlt: cue.alt,
      visualCueAttribution: cue.attribution,
      visualCueProvider: cue.provider,
    },
  });
  return toDto(updated);
}

async function resolvePronunciationRouting(target: Awaited<ReturnType<typeof findTargetForUser>>) {
  const configured = getConfiguredTtsProviderId();
  if (configured) {
    const config = await getAutoModelConfig().catch(() => null);
    return {
      providerId: configured,
      model:
        target.course.user.preferredTtsModel ??
        (config?.model.ttsProvider === configured ? config.model.ttsModel : null),
      source: 'server-configured',
    };
  }

  const preferredProvider = target.course.user.preferredTtsProvider;
  if (preferredProvider && isValidProviderId(preferredProvider)) {
    return {
      providerId: preferredProvider,
      model: target.course.user.preferredTtsModel,
      source: 'user-preferred',
    };
  }

  try {
    const config = await getAutoModelConfig();
    return {
      providerId: config.model.ttsProvider as TtsProviderId,
      model: config.model.ttsModel,
      source: 'auto-model',
    };
  } catch {
    throw new LearningTargetUnavailableError(
      `No TTS provider supports ${target.course.targetLang}`
    );
  }
}

export async function generateTargetPronunciation(
  courseId: string,
  userId: string,
  targetId: string
): Promise<LearningTargetDto> {
  const target = await findTargetForUser(courseId, userId, targetId);
  const routing = await resolvePronunciationRouting(target);
  const episodeId = `focus-${target.id}`;
  let provider: Awaited<ReturnType<typeof resolveTtsProvider>>['provider'];
  try {
    const resolved = await resolveTtsProvider({
      userId,
      episodeId,
      requestedProvider: routing.providerId,
      requestedModel: routing.model,
      language: target.course.targetLang,
    });
    provider = resolved.provider;
  } catch (error) {
    logger.warn('Learning-target pronunciation provider unavailable', {
      targetId: target.id,
      providerId: routing.providerId,
      model: routing.model,
      source: routing.source,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new LearningTargetUnavailableError(
      'Pronunciation is not available for the selected TTS provider'
    );
  }

  await assertStorageWritable();

  const voiceId = provider.getVoiceId('HOST', episodeId, undefined, target.course.targetLang);
  const audioBuffer = await provider.generateSpeech({
    text: target.text,
    voiceId,
    modelId: provider.getModelId(),
    language: target.course.targetLang,
  });
  const url = await uploadFile(
    `learning-targets/${courseId}/${target.id}.mp3`,
    audioBuffer,
    'audio/mpeg'
  );
  const updated = await prisma.learnerFocusTarget.update({
    where: { id: target.id },
    data: { pronunciationAudioUrl: url },
  });
  logger.info('Generated learning-target pronunciation', {
    targetId: target.id,
    providerId: routing.providerId,
    model: provider.getModelId(),
    source: routing.source,
    courseId,
  });
  return toDto(updated);
}
