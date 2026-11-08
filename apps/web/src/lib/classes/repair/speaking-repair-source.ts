import { createHash } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import { requireRepairQuizFence } from '../../learning/classes/formative/class-repair';
import { PreparationConflictError } from '../preparation-state';
import { requireStageGuard } from '../staging/stage-guard';

async function requireSpeakingFence(database: Prisma.TransactionClient) {
  await requireRepairQuizFence(database);
  await requireStageGuard(database, 'SPEAKING');
  await database.$executeRaw`LOCK TABLE "SpeakingPrompt", "SpeakingRecording" IN ROW EXCLUSIVE MODE`;
  const [result] = await database.$queryRaw<Array<{ valid: number }>>`
    WITH expected(table_name, trigger_name, trigger_type, old_table, new_table, function_name, body_hash) AS (
      VALUES
        ('SpeakingPrompt','SpeakingPrompt_formative_insert',4,NULL::text,'new_rows','touchFormativeChildStatement','5c2a77e411271a76bbb14d28e861350e'),
        ('SpeakingPrompt','SpeakingPrompt_formative_update',16,'old_rows','new_rows','touchFormativeChildStatement','5c2a77e411271a76bbb14d28e861350e'),
        ('SpeakingPrompt','SpeakingPrompt_formative_delete',8,'old_rows',NULL::text,'touchFormativeChildStatement','5c2a77e411271a76bbb14d28e861350e'),
        ('SpeakingRecording','SpeakingRecording_formative_insert',4,NULL::text,'new_rows','touchFormativeProgressStatement','f469a144216c83d3887e3371e876ec1e'),
        ('SpeakingRecording','SpeakingRecording_formative_update',16,'old_rows','new_rows','touchFormativeProgressStatement','f469a144216c83d3887e3371e876ec1e'),
        ('SpeakingRecording','SpeakingRecording_formative_delete',8,'old_rows',NULL::text,'touchFormativeProgressStatement','f469a144216c83d3887e3371e876ec1e'),
        ('SpeakingPrompt','SpeakingPrompt_incarnation_guard',23,NULL::text,NULL::text,'guardWritingIncarnation','385156a7739619df18157711be580c8d'),
        ('SpeakingRecording','SpeakingRecording_incarnation_guard',23,NULL::text,NULL::text,'guardWritingIncarnation','385156a7739619df18157711be580c8d')
    )
    SELECT count(*)::int AS valid FROM expected e
    JOIN pg_namespace n ON n.nspname = current_schema()
    JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = e.table_name
    JOIN pg_trigger t ON t.tgrelid = c.oid AND t.tgname = e.trigger_name
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_language l ON l.oid = p.prolang
    WHERE t.tgenabled IN ('O','A') AND t.tgtype = e.trigger_type
      AND t.tgoldtable IS NOT DISTINCT FROM e.old_table AND t.tgnewtable IS NOT DISTINCT FROM e.new_table
      AND t.tgnargs = 0 AND t.tgconstraint = 0 AND NOT t.tgisinternal AND t.tgqual IS NULL AND t.tgattr::text = ''
      AND p.pronamespace = n.oid AND p.proname = e.function_name AND p.pronargs = 0
      AND NOT p.prosecdef AND p.proconfig IS NULL AND l.lanname = 'plpgsql' AND md5(p.prosrc) = e.body_hash
  `;
  if (result?.valid !== 8)
    throw new PreparationConflictError('The speaking database fence is unavailable.');
}

/** Capture prior prompts and recordings while the caller holds the class lock. */
export async function speakingRepairSourceHash(
  database: Prisma.TransactionClient,
  classId: string,
  attempt: number
) {
  await requireSpeakingFence(database);
  await database.$queryRaw`SELECT id FROM "ClassSection" WHERE "classId" = ${classId} AND skill = 'SPEAKING' AND attempt < ${attempt} ORDER BY id FOR UPDATE`;
  await database.$queryRaw`SELECT p.id FROM "SpeakingPrompt" p JOIN "ClassSection" s ON s.id = p."sectionId" WHERE s."classId" = ${classId} AND s.skill = 'SPEAKING' AND s.attempt < ${attempt} ORDER BY p.id FOR UPDATE OF p`;
  const cls = await database.courseClass.findUniqueOrThrow({
    where: { id: classId },
    include: {
      course: { select: { userId: true } },
      sections: {
        where: { skill: 'SPEAKING', attempt: { lt: attempt } },
        orderBy: { id: 'asc' },
        include: { prompts: { orderBy: { id: 'asc' } } },
      },
    },
  });
  const sections = new Set(cls.sections.map((section) => section.id));
  const prompts = new Map(
    cls.sections.flatMap((section) =>
      section.prompts.map((prompt) => [prompt.id, { prompt, sectionId: section.id }] as const)
    )
  );
  const recordings = await database.speakingRecording.findMany({
    where: {
      OR: [{ sectionId: { in: [...sections] } }, { promptId: { in: [...prompts.keys()] } }],
    },
    orderBy: { id: 'asc' },
  });
  if (
    [...prompts.values()].some(
      ({ prompt }) => prompt.practiceSessionId || prompt.examSectionId || prompt.assessmentSectionId
    ) ||
    recordings.some((recording) => {
      const owner = prompts.get(recording.promptId);
      return (
        !owner ||
        recording.userId !== cls.course.userId ||
        (recording.sectionId !== null && recording.sectionId !== owner.sectionId) ||
        recording.practiceSessionId ||
        recording.examSectionId ||
        recording.assessmentSectionId
      );
    })
  )
    throw new PreparationConflictError('Saved speaking work has inconsistent ownership.');
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        id: cls.id,
        courseId: cls.courseId,
        progressRevision: cls.progressRevision,
        sections: cls.sections,
        recordings,
      })
    )
    .digest('hex');
}
