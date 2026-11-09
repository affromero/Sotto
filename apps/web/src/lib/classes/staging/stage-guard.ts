import type { Prisma } from '@/generated/prisma/client';
import { PreparationConflictError } from '../preparation-state';

const guards = {
  GRAMMAR: {
    stageTable: 'ClassGrammarStage',
    stageTrigger: 'ClassGrammarStage_guard',
    stageFunction: 'guardClassGrammarStage',
    stageHash: 'd3e18ab5a75de54f27d02589dbfbf628',
    activationTrigger: 'ClassSection_staged_grammar_guard',
    activationFunction: 'guardStagedGrammarActivation',
    activationHash: '7d4dd879c882fe8e2816fa2dda194a85',
  },
  READING: {
    stageTable: 'ClassReadingStage',
    stageTrigger: 'ClassReadingStage_guard',
    stageFunction: 'guardClassReadingStage',
    stageHash: '0adaf9fbdb34a74134224f60e449d9a7',
    activationTrigger: 'ClassSection_staged_reading_guard',
    activationFunction: 'guardStagedReadingActivation',
    activationHash: 'cbe7282c360649a1f08bbd0595e43a2e',
  },
  WRITING: {
    stageTable: 'ClassWritingStage',
    stageTrigger: 'ClassWritingStage_guard',
    stageFunction: 'guardClassWritingStage',
    stageHash: 'c62c76d55aac7d5333cce0a3790375a2',
    activationTrigger: 'ClassSection_staged_writing_guard',
    activationFunction: 'guardStagedWritingActivation',
    activationHash: '7731dd569b6588740daa7bb8f9a0351c',
  },
  SPEAKING: {
    stageTable: 'ClassSpeakingStage',
    stageTrigger: 'ClassSpeakingStage_guard',
    stageFunction: 'guardClassSpeakingStage',
    stageHash: '246fa5db428d07f1c60d6e2456f9da66',
    activationTrigger: 'ClassSection_staged_speaking_guard',
    activationFunction: 'guardStagedSpeakingActivation',
    activationHash: '7846b940ba80105c5b3c75cd79ca18ea',
  },
} as const;

/** Verify current guards and prevent table-level trigger DDL until this transaction ends. */
export async function requireStageGuard(
  database: Prisma.TransactionClient,
  skill: keyof typeof guards
) {
  if (skill === 'GRAMMAR')
    await database.$executeRaw`LOCK TABLE "ClassSection", "ClassGrammarStage" IN ROW EXCLUSIVE MODE`;
  else if (skill === 'READING')
    await database.$executeRaw`LOCK TABLE "ClassSection", "ClassReadingStage" IN ROW EXCLUSIVE MODE`;
  else if (skill === 'SPEAKING')
    await database.$executeRaw`LOCK TABLE "ClassSection", "ClassSpeakingStage" IN ROW EXCLUSIVE MODE`;
  else
    await database.$executeRaw`LOCK TABLE "ClassSection", "ClassWritingStage" IN ROW EXCLUSIVE MODE`;
  const expected = guards[skill];
  const [result] = await database.$queryRaw<Array<{ valid: number; origin: boolean }>>`
    WITH expected(table_name, trigger_name, trigger_type, function_name, body_hash, update_column) AS (
      VALUES
        (${expected.stageTable}, ${expected.stageTrigger}, 23, ${expected.stageFunction}, ${expected.stageHash}, NULL::text),
        ('ClassSection', ${expected.activationTrigger}, 19, ${expected.activationFunction}, ${expected.activationHash}, 'withdrawn')
    )
    SELECT count(*)::int AS valid, current_setting('session_replication_role') = 'origin' AS origin FROM expected e
    JOIN pg_namespace n ON n.nspname = current_schema()
    JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = e.table_name
    JOIN pg_trigger t ON t.tgrelid = c.oid AND t.tgname = e.trigger_name
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_language l ON l.oid = p.prolang
    WHERE t.tgenabled IN ('O','A') AND t.tgtype = e.trigger_type
      AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL AND t.tgnargs = 0
      AND t.tgconstraint = 0 AND NOT t.tgisinternal AND t.tgqual IS NULL
      AND (CASE WHEN e.update_column IS NULL THEN t.tgattr::text = '' ELSE EXISTS (
        SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = e.update_column
          AND NOT a.attisdropped AND t.tgattr::text = a.attnum::text
      ) END)
      AND p.pronamespace = n.oid AND p.proname = e.function_name AND p.pronargs = 0
      AND NOT p.prosecdef AND p.proconfig IS NULL AND l.lanname = 'plpgsql' AND md5(p.prosrc) = e.body_hash
  `;
  if (result?.valid !== 2 || !result.origin)
    throw new PreparationConflictError('The private repair stage database guard is unavailable.');
}
