import type { Prisma } from '@prisma/client';

/**
 * Prisma select for public-facing podcast fields.
 * Excludes internal/sensitive fields: failureReason, technicalError,
 * ttsProvider, aiProvider, importedAudioKey, draftData, etc.
 */
export const PODCAST_PUBLIC_SELECT = {
  id: true,
  title: true,
  topic: true,
  status: true,
  audioUrl: true,
  duration: true,
  fileSize: true,
  visibility: true,
  language: true,
  forkedFromId: true,
  remixNote: true,
  currentVersion: true,
  playCount: true,
  likeCount: true,
  forkCount: true,
  saveCount: true,
  commentCount: true,
  pdfUrl: true,
  isHumanContent: true,
  sourcePlatform: true,
  source: true,
  createdAt: true,
  updatedAt: true,
  userId: true,
} satisfies Prisma.PodcastSelect;
