// Course-scoped learner notes: free-text the learner writes about goals,
// background, and interests. Feeds placement + per-learner class/practice
// generation (never the shared curriculum). One editable doc per course.
import { prisma } from './prisma';

const MAX_NOTE_LENGTH = 4000;

/**
 * Render a learner note as an optional prompt block. Empty note → '' so the
 * `{{NOTES}}` placeholder collapses cleanly; otherwise a labelled block the
 * model uses to personalize examples/topics (without revealing it verbatim).
 */
export function formatNotesForPrompt(note: string): string {
  const trimmed = note.trim();
  if (trimmed === '') return '';
  return `\nLearner context — personalize examples, topics, and difficulty to this. Do not quote it back verbatim:\n${trimmed}\n`;
}

/** The learner's note for a course, or '' when none. Trimmed + length-capped. */
export async function getCourseNote(courseId: string): Promise<string> {
  const note = await prisma.courseNote.findUnique({
    where: { courseId },
    select: { body: true },
  });
  return (note?.body ?? '').trim().slice(0, MAX_NOTE_LENGTH);
}

/** Upsert the learner's note for a course. Empty body deletes the note. */
export async function setCourseNote(courseId: string, body: string): Promise<void> {
  const trimmed = body.trim().slice(0, MAX_NOTE_LENGTH);
  if (trimmed === '') {
    await prisma.courseNote.deleteMany({ where: { courseId } });
    return;
  }
  await prisma.courseNote.upsert({
    where: { courseId },
    create: { courseId, body: trimmed },
    update: { body: trimmed },
  });
}
