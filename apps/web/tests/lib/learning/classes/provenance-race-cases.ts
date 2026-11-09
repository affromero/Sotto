import { Client } from 'pg';
import { randomInt } from 'node:crypto';
import { expect } from 'vitest';
import type { SharedTestInstance } from '../../../helpers/setup/shared-instance';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import {
  acknowledgeInitialA1Provenance,
  readInitialA1Provenance,
  InitialA1ProvenanceConflict,
} from '@/lib/classes/lesson/initial-a1-provenance';

/** A task edit racing an acknowledgment must be visible to the next admission. */
export async function checkConcurrentPrerequisiteAcknowledgment(
  instance: SharedTestInstance,
  classId: string,
  receiptId: string,
  execution: SottoProviderExecution
) {
  const key = randomInt(1, 2_147_483_647);
  const connection = new Client({ connectionString: process.env.SIDEDOOR_TEST_DATABASE_URL });
  const writer = new Client({ connectionString: process.env.SIDEDOOR_TEST_DATABASE_URL });
  const schema = instance.schema;
  await connection.connect();
  await writer.connect();
  await writer.query(`SET search_path TO "${schema}"`);
  await connection.query('SELECT pg_advisory_lock($1::bigint)', [key]);
  let writing: Promise<unknown> | undefined;
  try {
    await instance.database
      .$executeRawUnsafe(`CREATE FUNCTION "${schema}"."test_pause_ack"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."prerequisiteGate" #>> '{acknowledgment,receiptId}' IS NOT NULL THEN
          PERFORM pg_advisory_xact_lock(${key});
        END IF;
        RETURN NEW;
      END $$`);
    await instance.database.$executeRawUnsafe(
      `CREATE TRIGGER "test_pause_ack" BEFORE UPDATE OF "prerequisiteGate" ON "${schema}"."CourseClass" FOR EACH ROW EXECUTE FUNCTION "${schema}"."test_pause_ack"()`
    );
    const pending = acknowledgeInitialA1Provenance(
      instance.database,
      { classId, receiptId },
      execution
    ).then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (error: unknown) => ({ status: 'rejected' as const, error })
    );
    let waiting = false;
    for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
      const result = await connection.query<{ waiting: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objid = $1) AS waiting`,
        [key]
      );
      waiting = result.rows[0]!.waiting;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(waiting).toBe(true);
    const question = await instance.database.lessonQuestion.findFirstOrThrow({
      where: { section: { classId } },
    });
    const writerPid = (await writer.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
      .rows[0]!.pid;
    writing = writer.query(
      `UPDATE "${schema}"."LessonQuestion" SET explanation = $1 WHERE id = $2`,
      ['Changed while acknowledging', question.id]
    );
    let writerBlocked = false;
    for (let attempt = 0; attempt < 100 && !writerBlocked; attempt++) {
      const result = await connection.query<{ blocked: boolean }>(
        'SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked',
        [writerPid]
      );
      writerBlocked = result.rows[0]!.blocked;
      if (!writerBlocked) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(writerBlocked).toBe(true);
    await connection.query('SELECT pg_advisory_unlock($1::bigint)', [key]);
    const result = await pending;
    await writing;
    if (result.status === 'fulfilled')
      expect(result.value).toMatchObject({ status: 'REVIEWED', receiptId, acknowledged: true });
    else expect(result.error).toBeInstanceOf(InitialA1ProvenanceConflict);
    expect(await readInitialA1Provenance(instance.database, classId, execution)).toEqual({
      status: 'STALE',
    });
  } finally {
    await connection.query('SELECT pg_advisory_unlock($1::bigint)', [key]);
    await writing?.catch(() => undefined);
    await instance.database.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS "test_pause_ack" ON "${schema}"."CourseClass"`
    );
    await instance.database.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS "${schema}"."test_pause_ack"()`
    );
    await connection.end();
    await writer.end();
  }
}
