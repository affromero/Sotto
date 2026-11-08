import { createHash } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import {
  quizRetrySourceDigest,
  requireRepairQuizFence,
} from '../../learning/classes/formative/class-repair';
import { PreparationConflictError } from '../preparation-state';

async function requireGrammarEvidenceFence(database: Prisma.TransactionClient) {
  await database.$executeRaw`LOCK TABLE "ClassSubmission", "SectionAnswer", "ClassGrammarStage" IN ROW EXCLUSIVE MODE`;
  const [result] = await database.$queryRaw<Array<{ valid: number }>>`
    WITH expected(table_name, trigger_name, trigger_type, old_table, new_table, function_name, body_hash, update_column) AS (
      VALUES
        ('ClassSubmission','ClassSubmission_formative_insert',4,NULL::text,'new_rows','touchClassSubmissionStatement','e794f2cb54ec2eeb9089905258c65155',NULL::text),
        ('ClassSubmission','ClassSubmission_formative_update',16,'old_rows','new_rows','touchClassSubmissionStatement','e794f2cb54ec2eeb9089905258c65155',NULL::text),
        ('ClassSubmission','ClassSubmission_formative_delete',8,'old_rows',NULL::text,'touchClassSubmissionStatement','e794f2cb54ec2eeb9089905258c65155',NULL::text),
        ('SectionAnswer','SectionAnswer_formative_insert',4,NULL::text,'new_rows','touchSectionAnswerStatement','b9af7052124e1e2c44855b560b72dd61',NULL::text),
        ('SectionAnswer','SectionAnswer_formative_update',16,'old_rows','new_rows','touchSectionAnswerStatement','b9af7052124e1e2c44855b560b72dd61',NULL::text),
        ('SectionAnswer','SectionAnswer_formative_delete',8,'old_rows',NULL::text,'touchSectionAnswerStatement','b9af7052124e1e2c44855b560b72dd61',NULL::text),
        ('ClassSubmission','ClassSubmission_incarnation_guard',23,NULL::text,NULL::text,'guardWritingIncarnation','385156a7739619df18157711be580c8d',NULL::text),
        ('SectionAnswer','SectionAnswer_incarnation_guard',23,NULL::text,NULL::text,'guardWritingIncarnation','385156a7739619df18157711be580c8d',NULL::text),
        ('ClassGrammarStage','ClassGrammarStage_guard',23,NULL::text,NULL::text,'guardClassGrammarStage','d3e18ab5a75de54f27d02589dbfbf628',NULL::text),
        ('ClassSection','ClassSection_staged_grammar_guard',19,NULL::text,NULL::text,'guardStagedGrammarActivation','7d4dd879c882fe8e2816fa2dda194a85','withdrawn')
    )
    SELECT count(*)::int AS valid FROM expected e
    JOIN pg_namespace n ON n.nspname = current_schema()
    JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = e.table_name
    JOIN pg_trigger t ON t.tgrelid = c.oid AND t.tgname = e.trigger_name
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_language l ON l.oid = p.prolang
    WHERE t.tgenabled IN ('O','A') AND t.tgtype = e.trigger_type
      AND t.tgoldtable IS NOT DISTINCT FROM e.old_table AND t.tgnewtable IS NOT DISTINCT FROM e.new_table
      AND t.tgnargs = 0 AND t.tgconstraint = 0 AND NOT t.tgisinternal AND t.tgqual IS NULL
      AND (CASE WHEN e.update_column IS NULL THEN t.tgattr::text = '' ELSE EXISTS (
        SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = e.update_column
          AND NOT a.attisdropped AND t.tgattr::text = a.attnum::text
      ) END)
      AND p.pronamespace = n.oid AND p.proname = e.function_name AND p.pronargs = 0
      AND NOT p.prosecdef AND p.proconfig IS NULL AND l.lanname = 'plpgsql' AND md5(p.prosrc) = e.body_hash
  `;
  if (result?.valid !== 10)
    throw new PreparationConflictError('The grammar evidence database fence is unavailable.');
}

/** Capture all saved grammar and learner answers while the caller holds the class lock. */
export async function grammarRepairSourceHash(
  database: Prisma.TransactionClient,
  classId: string,
  attempt: number
) {
  await requireRepairQuizFence(database);
  await requireGrammarEvidenceFence(database);
  await database.$queryRaw`SELECT id FROM "ClassSection" WHERE "classId" = ${classId} AND skill = 'GRAMMAR' AND attempt < ${attempt} ORDER BY id FOR UPDATE`;
  const cls = await database.courseClass.findUniqueOrThrow({
    where: { id: classId },
    include: {
      sections: {
        where: { skill: 'GRAMMAR', attempt: { lt: attempt } },
        include: { questions: true },
      },
    },
  });
  const submission = await database.classSubmission.findUnique({
    where: { classId },
    include: { answers: { orderBy: { id: 'asc' } } },
  });
  const linkedAnswers = await database.sectionAnswer.findMany({
    where: {
      OR: [
        { sectionId: { in: cls.sections.map((section) => section.id) } },
        {
          questionId: {
            in: cls.sections.flatMap((section) => section.questions.map((question) => question.id)),
          },
        },
      ],
    },
    select: { submission: { select: { classId: true } } },
  });
  if (linkedAnswers.some((answer) => answer.submission.classId !== classId))
    throw new PreparationConflictError('Saved grammar answers have inconsistent class ownership.');
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        progressRevision: cls.progressRevision,
        digest: quizRetrySourceDigest(cls, 'GRAMMAR', attempt),
        submission,
      })
    )
    .digest('hex');
}
