import { StorageWriteJournal } from 'thesidedoor-core/storage';
import type { Prisma } from '@/generated/prisma/client';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';

/** Retained journal entries still require exact storage cleanup or reconciliation. */
export async function hasUnsettledSpeakingReferenceWrites(
  database: Prisma.TransactionClient,
  courseId: string
): Promise<boolean> {
  const writes = new StorageWriteJournal(
    { query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
    'postgres',
    SIDEDOOR_STATE_ID
  );
  let cursor: string | undefined;
  let scanned = 0;
  do {
    const page = await writes.list(`course:${courseId}`, { after: cursor, limit: 100 });
    if (page.intents.some((intent) => intent.target.key.startsWith('speaking-ref/'))) return true;
    scanned += page.intents.length;
    if (scanned >= 2000 && page.cursor) return true;
    cursor = page.cursor ?? undefined;
  } while (cursor);
  return false;
}

/** Check current class writers and older course-scoped writers for its saved prompts. */
export async function hasUnsettledClassSpeakingReferenceWrites(
  database: Prisma.TransactionClient,
  courseId: string,
  classId: string
): Promise<boolean> {
  const prompts = await database.speakingPrompt.findMany({
    where: { section: { classId } },
    select: { id: true },
  });
  const ids = new Set(prompts.map((prompt) => prompt.id));
  const writes = new StorageWriteJournal(
    { query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
    'postgres',
    SIDEDOOR_STATE_ID
  );
  for (const subject of [`class:${classId}`, `course:${courseId}`]) {
    let cursor: string | undefined;
    let scanned = 0;
    do {
      const page = await writes.list(subject, { after: cursor, limit: 100 });
      if (
        page.intents.some((intent) => {
          const [prefix, promptId] = intent.target.key.split('/');
          return prefix === 'speaking-ref' && (subject.startsWith('class:') || ids.has(promptId));
        })
      )
        return true;
      scanned += page.intents.length;
      if (scanned >= 2000 && page.cursor) return true;
      cursor = page.cursor ?? undefined;
    } while (cursor);
  }
  return false;
}
