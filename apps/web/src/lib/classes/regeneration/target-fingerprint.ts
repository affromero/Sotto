import { createHash } from 'node:crypto';

export function targetFingerprint(target: {
  id: string;
  courseId: string;
  lessonId: string;
  createdAt: Date;
  sourceUrl: string | null;
  sourceTitle: string | null;
}) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        target.id,
        target.courseId,
        target.lessonId,
        target.createdAt.getTime(),
        target.sourceUrl,
        target.sourceTitle,
      ])
    )
    .digest('hex');
}
