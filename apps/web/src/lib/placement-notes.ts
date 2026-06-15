// Orchestration for notes-based placement: deduce a level from uploaded
// materials and cache the result (with the materials) so the learner can
// confirm directly or verify with a short quiz, then create the course. No DB
// writes happen here — the course does not exist until confirmation.
import { cache } from '@/lib/redis';
import { deduceLevelFromNotes, type NotesDeduction } from '@/lib/placement-test';

const NOTES_TTL_SECONDS = 3600;

// Distinct namespace from the MC placement cache (`placement:...`) so a pending
// notes deduction never collides with an in-flight question batch for the pair.
function notesCacheKey(userId: string, native: string, target: string): string {
  return `placement-notes:${userId}:${native}_${target}`;
}

export interface CachedNotesDeduction extends NotesDeduction {
  /** The extracted materials, reused as the course note on confirmation. */
  content: string;
}

/**
 * Deduce the CEFR level from `content` and cache it (with the materials) for the
 * confirm/verify step. Returns the deduction; performs no DB writes.
 */
export async function runNotesDeduction(
  userId: string,
  native: string,
  target: string,
  content: string,
): Promise<NotesDeduction> {
  const { deduction } = await deduceLevelFromNotes(userId, native, target, content);
  const cached: CachedNotesDeduction = { ...deduction, content };
  await cache.set(notesCacheKey(userId, native, target), cached, NOTES_TTL_SECONDS);
  return deduction;
}

/** Read a cached notes deduction (materials + level) for the confirm step. */
export async function getCachedNotesDeduction(
  userId: string,
  native: string,
  target: string,
): Promise<CachedNotesDeduction | null> {
  return cache.get<CachedNotesDeduction>(notesCacheKey(userId, native, target));
}

/** Drop the cached deduction after the course is created. Best-effort. */
export async function clearNotesDeduction(
  userId: string,
  native: string,
  target: string,
): Promise<void> {
  await cache.delete(notesCacheKey(userId, native, target)).catch(() => {});
}
