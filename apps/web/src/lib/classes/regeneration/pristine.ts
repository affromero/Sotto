import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { readPreparationAudioBinding } from '../preparation-audio';
import { classPreparationStore } from '../preparation';
import { classPreparationGrant } from '../preparation-grant';
import type { SkillRequirements } from '@sotto/shared';

export const pristineSnapshotSchema = z.string().regex(/^[a-f0-9]{64}$/);
export class PristineRegenerationConflict extends Error {
  constructor() {
    super(
      'Class changed, contains learner work, or still has active jobs. Reload before regenerating.'
    );
    this.name = 'PristineRegenerationConflict';
  }
}

const savedAnswersSchema = z.record(z.string(), z.number().int().nonnegative());
const savedDraftsSchema = z.record(z.string(), z.string());

function containsSavedWork(answers: unknown, drafts: unknown): boolean {
  const parsedAnswers = savedAnswersSchema.safeParse(answers ?? {});
  const parsedDrafts = savedDraftsSchema.safeParse(drafts ?? {});
  return (
    !parsedAnswers.success ||
    !parsedDrafts.success ||
    Object.keys(parsedAnswers.data).length > 0 ||
    Object.values(parsedDrafts.data).some((draft) => draft.trim().length > 0)
  );
}

export async function readPristine(
  database: Prisma.TransactionClient,
  classId: string,
  userId: string
) {
  const cls = await database.courseClass.findFirst({
    where: { id: classId, course: { userId } },
    include: {
      course: true,
      lesson: true,
      submission: true,
      sections: {
        orderBy: { id: 'asc' },
        include: {
          questions: { orderBy: { id: 'asc' } },
          prompts: { orderBy: { id: 'asc' }, include: { recordings: true } },
          writingPrompts: { orderBy: { id: 'asc' }, include: { responses: true } },
          episode: {
            select: {
              id: true,
              createdAt: true,
              updatedAt: true,
              status: true,
              audioGenerationKey: true,
            },
          },
        },
      },
    },
  });
  if (
    !cls ||
    !['AVAILABLE', 'FAILED'].includes(cls.status) ||
    cls.submission ||
    containsSavedWork(cls.learnerAnswers, cls.writingDrafts) ||
    cls.submittedAt ||
    cls.passedAt ||
    (cls.status !== 'FAILED' && cls.failedAt) ||
    cls.sections.some(
      (section) =>
        !(cls.status === 'FAILED'
          ? ['PENDING', 'GENERATING', 'READY', 'FAILED'].includes(section.status)
          : section.status === 'READY') ||
        section.score !== null ||
        section.passed !== null ||
        section.prompts.some((prompt) => prompt.recordings.length > 0) ||
        section.writingPrompts.some((prompt) => prompt.responses.length > 0)
    )
  )
    throw new PristineRegenerationConflict();
  const sectionIds = cls.sections.map((section) => section.id);
  const [answers, recordings, responses] = await Promise.all([
    database.sectionAnswer.count({ where: { sectionId: { in: sectionIds } } }),
    database.speakingRecording.count({ where: { sectionId: { in: sectionIds } } }),
    database.writingResponse.count({ where: { sectionId: { in: sectionIds } } }),
  ]);
  if (answers || recordings || responses) throw new PristineRegenerationConflict();
  const outbox = sottoJobOutbox(database);
  const executions = sottoJobExecutions(database);
  for (const section of cls.sections) {
    const episode = section.episode;
    if (!episode) continue;
    if (!['READY', 'SCRIPT_READY'].includes(episode.status)) {
      const lineage = await readPreparationAudioBinding(database, episode.id);
      const operation = await classPreparationStore(database, cls.courseId).read();
      if (
        !lineage ||
        !operation ||
        operation.id !== lineage.operationId ||
        !(
          operation.status === 'CANCELLED' ||
          (operation.status === 'FAILED' &&
            (operation.failure === 'generation_failed' ||
              operation.failure === 'source_unreadable'))
        ) ||
        operation.classId !== classId ||
        operation.userId !== userId ||
        lineage.audioGenerationKey !== episode.audioGenerationKey ||
        lineage.grant.fingerprint !== operation.grant.fingerprint ||
        !operation.audioEpisodeIds.includes(episode.id) ||
        (await classPreparationGrant(database, operation).read(operation.grant)).status !==
          'revoked'
      )
        throw new PristineRegenerationConflict();
    }
    let cursor: string | null = null;
    let scanned = 0;
    do {
      const page = await outbox.listForScope(
        `episode:${episode.id}`,
        episode.createdAt.getTime(),
        cursor
      );
      for (const reference of page.jobs) {
        if (++scanned > 2000) throw new PristineRegenerationConflict();
        const record = await outbox.read(reference.id);
        if (
          !record?.complete ||
          record.fingerprint !== reference.fingerprint ||
          (await executions.blockingStatus(reference.id, reference.fingerprint))
        )
          throw new PristineRegenerationConflict();
        await executions.requireParentDrained(reference.id, reference.fingerprint);
      }
      cursor = page.cursor;
    } while (cursor);
  }
  const snapshot = createHash('sha256').update(JSON.stringify(cls)).digest('hex');
  return { cls, snapshot };
}

export async function readPristineRegenerationSnapshot(
  classId: string,
  execution: SottoProviderExecution
) {
  return sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      await execution.authorize(database);
      return (await readPristine(database, classId, execution.userId)).snapshot;
    },
    { signal: execution.signal }
  );
}

export async function validatePristineRegeneration(
  classId: string,
  execution: SottoProviderExecution,
  expected: string
) {
  pristineSnapshotSchema.parse(expected);
  return sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      await execution.authorize(database);
      const { cls, snapshot } = await readPristine(database, classId, execution.userId);
      if (snapshot !== expected) throw new PristineRegenerationConflict();
      return cls;
    },
    { signal: execution.signal }
  );
}

/** The guard and removal share one Serializable transaction; no provider work occurs here. */
export async function claimPristineRegeneration(
  classId: string,
  execution: SottoProviderExecution,
  expected: string,
  requirements?: SkillRequirements
) {
  pristineSnapshotSchema.parse(expected);
  return sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      await execution.authorize(database);
      const { cls, snapshot } = await readPristine(database, classId, execution.userId);
      if (snapshot !== expected) throw new PristineRegenerationConflict();
      const attempt = Math.max(cls.attempt, ...cls.sections.map((section) => section.attempt)) + 1;
      const claimed = await database.courseClass.updateMany({
        where: { id: classId, status: cls.status, updatedAt: cls.updatedAt, attempt: cls.attempt },
        data: {
          status: 'GENERATING',
          failedAt: null,
          attempt,
          adaptiveSeed: Prisma.JsonNull,
          worksheetPdfUrl: null,
          ...(requirements
            ? { skillRequirements: requirements as unknown as Prisma.InputJsonValue }
            : {}),
        },
      });
      if (claimed.count !== 1) throw new PristineRegenerationConflict();
      await database.classSection.deleteMany({ where: { classId } });
      return { ...cls, attempt };
    },
    { signal: execution.signal }
  );
}
