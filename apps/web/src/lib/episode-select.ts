import type { Prisma } from '@/generated/prisma/client';

/**
 * Prisma select for public-facing episode fields.
 * Excludes internal/sensitive fields: failureReason, technicalError,
 * ttsProvider, aiProvider, draftData, etc.
 */
export const EPISODE_PUBLIC_SELECT = {
  id: true,
  title: true,
  topic: true,
  status: true,
  audioUrl: true,
  duration: true,
  fileSize: true,
  visibility: true,
  language: true,
  currentVersion: true,
  playCount: true,
  saveCount: true,
  pdfUrl: true,
  lowReferences: true,
  sourcePlatform: true,
  source: true,
  slug: true,
  createdAt: true,
  updatedAt: true,
  userId: true,
} satisfies Prisma.EpisodeSelect;
