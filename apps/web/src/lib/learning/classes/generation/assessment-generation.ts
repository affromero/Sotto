import type { SkillType } from '@sotto/shared';
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { learningProviderInputHash } from '@/lib/learning/preparation/identity';
import {
  runSottoExecutionOperation,
  verifySottoExecutionOperation,
  type SottoJobExecutionCapability,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { authorAssessmentSection } from './assessment-authoring';
import { stageAssessmentSection } from './assessment-draft';
import { invokeAssessmentProviderStage } from '../provider/assessment-provider-stage';
import { AssessmentFenceConflict } from '../lifecycle/assessment-fence';
import { requirePendingAssessmentWork } from './assessment-work';
import { assessmentCallInventoryDigest } from '../provider/assessment-provider-journal';
import { capturePriorAssessmentExposure } from '../history/assessment-prior-exposure';

const stages = {
  GRAMMAR: 'AUTHOR_GRAMMAR',
  READING: 'AUTHOR_READING',
  LISTENING: 'AUTHOR_LISTENING',
  SPEAKING: 'AUTHOR_SPEAKING',
  WRITING: 'AUTHOR_WRITING',
} as const;

type AuthorProof = Readonly<{ skill: SkillType; sectionId: string }>;
const authorProofs = new WeakMap<
  AuthorProof,
  (database: Prisma.TransactionClient) => Promise<void>
>();

/** Generate and stage only the exact owned section. Publication requires separate review. */
export async function generateAssessmentSection(input: {
  identity: { id: string; fingerprint: string };
  execution: SottoProviderExecution;
  skill: SkillType;
  unresolved: () => void;
}) {
  const result = await runAssessmentSection(input, false);
  return { sectionId: result.sectionId };
}

/** Rebuild an in-process proof from retained calls without dispatching a provider. */
export async function prepareAssessmentAuthorProof(input: {
  identity: { id: string; fingerprint: string };
  execution: SottoProviderExecution;
  skill: SkillType;
}) {
  const skill = input.skill;
  const result = await runAssessmentSection(
    {
      ...input,
      skill,
      unresolved: () => {
        throw new AssessmentFenceConflict();
      },
    },
    true
  );
  const proof = Object.freeze({ skill, sectionId: result.sectionId });
  authorProofs.set(proof, result.verify);
  return proof;
}

/** Resume a staged section offline; dispatch only when no draft has been saved. */
export function prepareOrGenerateAssessmentAuthorProof(input: {
  identity: { id: string; fingerprint: string };
  execution: SottoProviderExecution;
  capability: SottoJobExecutionCapability;
  skill: SkillType;
  unresolved: () => void;
}) {
  const expected = { parentId: input.identity.id, fingerprint: input.identity.fingerprint };
  return runSottoExecutionOperation(input.capability, expected, async (operation, signal) => {
    const execution = {
      ...input.execution,
      signal: input.execution.signal ? AbortSignal.any([input.execution.signal, signal]) : signal,
    };
    const staged = await sottoTransaction(
      prisma,
      async (database) => {
        const pending = await requirePendingAssessmentWork(
          database,
          input.identity,
          execution,
          'RUNNING'
        );
        if (pending.current.requirements.skills[input.skill].state !== 'REQUIRED')
          throw new AssessmentFenceConflict();
        await verifySottoExecutionOperation(database, operation, expected);
        const section = await database.classAssessmentSection.findUniqueOrThrow({
          where: {
            assessmentId_skill: { assessmentId: pending.current.assessmentId, skill: input.skill },
          },
          select: { authoredDraft: true },
        });
        return section.authoredDraft !== null;
      },
      { signal }
    );
    const context = { identity: input.identity, execution, skill: input.skill };
    if (!staged) await generateAssessmentSection({ ...context, unresolved: input.unresolved });
    const proof = await prepareAssessmentAuthorProof(context);
    await sottoTransaction(
      prisma,
      async (database) => {
        await requirePendingAssessmentWork(database, input.identity, execution, 'RUNNING');
        await verifySottoExecutionOperation(database, operation, expected);
        await verifyAssessmentAuthorProof(database, proof);
      },
      { signal }
    );
    return proof;
  });
}

/** Accept only a locally reconstructed proof and recheck it in the sealing transaction. */
export async function verifyAssessmentAuthorProof(
  database: Prisma.TransactionClient,
  proof: AuthorProof
) {
  const verify = authorProofs.get(proof);
  if (!verify) throw new AssessmentFenceConflict();
  const isolation = await database.$queryRaw<{ isolation: string }[]>`
    SELECT current_setting('transaction_isolation') AS isolation`;
  if (isolation[0]?.isolation !== 'serializable')
    throw new Error('Assessment author proof requires a Serializable transaction');
  await verify(database);
  return { skill: proof.skill, sectionId: proof.sectionId };
}

async function runAssessmentSection(
  input: {
    identity: { id: string; fingerprint: string };
    execution: SottoProviderExecution;
    skill: SkillType;
    unresolved: () => void;
  },
  replayOnly: boolean
) {
  const identity = { ...input.identity };
  const execution = { ...input.execution };
  const skill = input.skill;
  const signal = execution.signal ?? new AbortController().signal;
  const { current, source, priorAssessments } = await sottoTransaction(
    prisma,
    async (database) => {
      const pending = await requirePendingAssessmentWork(database, identity, execution, 'RUNNING');
      const prior = await capturePriorAssessmentExposure(database, {
        classId: pending.current.classId,
        courseId: pending.current.courseId,
        userId: pending.current.userId,
        classAttempt: pending.current.classAttempt,
        assessmentAttempt: pending.current.assessmentAttempt,
      });
      return { ...pending, priorAssessments: prior };
    },
    { signal }
  );
  const stage = stages[skill];
  if (!stage || current.requirements.skills[skill].state !== 'REQUIRED')
    throw new Error('This assessment skill is not required.');
  const sourceDigest = learningProviderInputHash({
    version: 1,
    stage,
    classId: current.classId,
    assessmentId: current.assessmentId,
    classAttempt: current.classAttempt,
    assessmentAttempt: current.assessmentAttempt,
    ...(current.materialVersion === 2 ? { materialVersion: 2 } : {}),
    ...(current.speakingPolicy ? { speakingPolicy: current.speakingPolicy } : {}),
    formativeRevision: current.formativeRevision,
    teachingReceipt: current.teachingReceipt,
    requirements: source.requirements,
    source: source.source,
    prerequisite: source.prerequisite,
    ...(priorAssessments.length ? { priorTasks: priorAssessments.map((item) => item.tasks) } : {}),
    selection: current.selection,
    cliBinding: current.cliBinding,
  });
  let invocation: Awaited<ReturnType<typeof invokeAssessmentProviderStage>> | undefined;
  const draft = await authorAssessmentSection(
    {
      source: source.source,
      prerequisite: source.prerequisite,
      requirements: source.requirements,
      skill,
      ...(priorAssessments.length
        ? { priorTasks: priorAssessments.map((item) => item.tasks) }
        : {}),
      ...(current.materialVersion === 2 ? { materialVersion: 2 as const } : {}),
      ...(current.speakingPolicy ? { speakingPolicy: current.speakingPolicy } : {}),
    },
    async ({ system, payload, schema }) => {
      invocation = await invokeAssessmentProviderStage({
        identity,
        execution,
        current,
        stage,
        sourceDigest,
        unresolved: input.unresolved,
        replayOnly,
        request: { system, payload, schema, schemaName: 'class_assessment_section' },
      });
      return invocation.content;
    }
  );
  if (!invocation) throw new AssessmentFenceConflict();
  const verified = invocation;
  return sottoTransaction(
    prisma,
    async (database) => {
      const pending = await requirePendingAssessmentWork(database, identity, execution, 'RUNNING');
      if (!isDeepStrictEqual(pending.current, current)) throw new AssessmentFenceConflict();
      const prior = await capturePriorAssessmentExposure(database, {
        classId: current.classId,
        courseId: current.courseId,
        userId: current.userId,
        classAttempt: current.classAttempt,
        assessmentAttempt: current.assessmentAttempt,
      });
      if (!isDeepStrictEqual(prior, priorAssessments)) throw new AssessmentFenceConflict();
      await database.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${current.assessmentId} FOR UPDATE`;
      await database.$queryRaw`SELECT id FROM "ClassAssessmentProviderCall" WHERE "assessmentId" = ${current.assessmentId} AND stage = ${stage} ORDER BY ordinal FOR UPDATE`;
      await verified.verify(database);
      const section = await database.classAssessmentSection.findUniqueOrThrow({
        where: { assessmentId_skill: { assessmentId: current.assessmentId, skill } },
      });
      if (replayOnly && section.authoredDraft === null) throw new AssessmentFenceConflict();
      const result = await stageAssessmentSection(database, identity, execution, draft);
      const calls = await database.classAssessmentProviderCall.findMany({
        where: { assessmentId: current.assessmentId, stage },
        orderBy: { ordinal: 'asc' },
      });
      const inventory = assessmentCallInventoryDigest(calls);
      const verify = async (tx: Prisma.TransactionClient) => {
        const refreshed = await requirePendingAssessmentWork(tx, identity, execution, 'RUNNING');
        if (!isDeepStrictEqual(refreshed.current, current)) throw new AssessmentFenceConflict();
        const prior = await capturePriorAssessmentExposure(tx, {
          classId: current.classId,
          courseId: current.courseId,
          userId: current.userId,
          classAttempt: current.classAttempt,
          assessmentAttempt: current.assessmentAttempt,
        });
        if (!isDeepStrictEqual(prior, priorAssessments)) throw new AssessmentFenceConflict();
        await tx.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${current.assessmentId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "ClassAssessmentProviderCall" WHERE "assessmentId" = ${current.assessmentId} AND stage = ${stage} ORDER BY ordinal FOR UPDATE`;
        await verified.verify(tx);
        const saved = await tx.classAssessmentSection.findUniqueOrThrow({
          where: { assessmentId_skill: { assessmentId: current.assessmentId, skill } },
        });
        if (saved.id !== result.sectionId || saved.authoredDraft === null)
          throw new AssessmentFenceConflict();
        const staged = await stageAssessmentSection(tx, identity, execution, draft);
        if (staged.sectionId !== result.sectionId) throw new AssessmentFenceConflict();
        const rows = await tx.classAssessmentProviderCall.findMany({
          where: { assessmentId: current.assessmentId, stage },
          orderBy: { ordinal: 'asc' },
        });
        if (assessmentCallInventoryDigest(rows) !== inventory) throw new AssessmentFenceConflict();
      };
      return { ...result, verify };
    },
    { signal }
  );
}
