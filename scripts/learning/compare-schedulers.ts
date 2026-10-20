import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { Client } from 'pg';
import {
  compareReviewEvents,
  comparisonEventSchema,
  type ComparisonEvent,
} from '../../apps/web/src/lib/learning/review/comparison';

const { values } = parseArgs({
  options: {
    input: { type: 'string' },
    export: { type: 'string' },
    'course-id': { type: 'string' },
    'user-id': { type: 'string' },
    'test-after': { type: 'string' },
  },
});

async function readJournal(): Promise<ComparisonEvent[]> {
  const courseId = values['course-id'];
  const userId = values['user-id'];
  if (!courseId || !userId)
    throw new Error('Database comparison requires --course-id and --user-id.');
  const connectionString = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error('A database connection is required.');
  const database = new Client({ connectionString });
  await database.connect();
  try {
    await database.query('BEGIN READ ONLY');
    const owned = await database.query('SELECT id FROM "Course" WHERE id = $1 AND "userId" = $2', [
      courseId,
      userId,
    ]);
    if (owned.rowCount !== 1) throw new Error('The owned course was not found.');
    const result = await database.query<Record<string, unknown>>(
      `
      SELECT "sequence"::text, COALESCE('vocab:' || "vocabId", 'grammar:' || "grammarId") AS target,
        assessment, "questionIds", quality, "reviewedAt" AT TIME ZONE 'UTC' AS "reviewedAt",
        "schedulerVersion", "before", "after"
      FROM "LearnerReviewEvent" WHERE "courseId" = $1 ORDER BY "reviewedAt", "sequence"
    `,
      [courseId]
    );
    const events = result.rows.map((row) => ({
      ...row,
      reviewedAt: row.reviewedAt instanceof Date ? row.reviewedAt.toISOString() : row.reviewedAt,
    }));
    await database.query('COMMIT');
    return comparisonEventSchema.array().parse(events);
  } finally {
    await database.end();
  }
}

async function main() {
  if (!values['test-after']) throw new Error('Supply --test-after with a fixed ISO timestamp.');
  const cutoff = new Date(comparisonEventSchema.shape.reviewedAt.parse(values['test-after']));
  if (values.input && (values['course-id'] || values['user-id']))
    throw new Error('Choose an input file or an owned database course.');
  const events = values.input
    ? comparisonEventSchema.array().parse(JSON.parse(await readFile(values.input, 'utf8')))
    : await readJournal();
  if (values.export)
    await writeFile(values.export, JSON.stringify(events, null, 2) + '\n', {
      mode: 0o600,
      flag: 'wx',
    });
  process.stdout.write(JSON.stringify(compareReviewEvents(events, cutoff), null, 2) + '\n');
}

main().catch(() => {
  process.stderr.write(
    'Scheduler comparison failed. Check the input, cutoff, owned course and database configuration.\n'
  );
  process.exitCode = 1;
});
