import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import {
  classPrerequisiteDirectionTaskSchema,
  classPrerequisiteDirectionsSchema,
} from '@sotto/shared';
import { prerequisitePublicSourceSchema } from './prerequisite-source';
import {
  PrerequisiteCapacityError,
  requireModeratedPrerequisitePayload,
} from './prerequisite-json';

type TaskKind = z.infer<typeof classPrerequisiteDirectionTaskSchema>['kind'];
const skill = z.enum(['GRAMMAR', 'READING', 'LISTENING', 'SPEAKING', 'WRITING']);
const identity = { sectionId: z.string().min(1), taskId: z.string().min(1), skill };
const directionInputSchema = z.discriminatedUnion('kind', [
  z.object({ ...identity, kind: z.literal('question'), prompt: z.string().min(1) }).strict(),
  z
    .object({
      ...identity,
      kind: z.literal('speaking'),
      prompt: z.string().min(1),
      context: z.string().min(1),
      taskMode: z.enum(['READ_ALOUD', 'COMMUNICATIVE']),
    })
    .strict(),
  z
    .object({
      ...identity,
      kind: z.literal('writing'),
      prompt: z.string().min(1),
      context: z.string().nullable(),
    })
    .strict(),
]);
const prerequisiteDirectionTaskSchema = classPrerequisiteDirectionTaskSchema;
export const prerequisiteDirectionBatchSchema = z
  .object({
    guided: classPrerequisiteDirectionsSchema.shape.guided.nullable(),
    tasks: z.array(prerequisiteDirectionTaskSchema).min(1).max(7),
  })
  .strict();

/** Each instruction is tied to the exact current section and exercise. */
export const prerequisiteDirectionsSchema = classPrerequisiteDirectionsSchema;

type TaskSource = {
  sections: ReadonlyArray<{
    id: string;
    skill: 'GRAMMAR' | 'READING' | 'LISTENING' | 'SPEAKING' | 'WRITING';
    questions: ReadonlyArray<{ id: string }>;
    speaking: ReadonlyArray<{ id: string }>;
    writing: ReadonlyArray<{ id: string }>;
  }>;
};

type PublicSource = z.infer<typeof prerequisitePublicSourceSchema>;

const TASKS_PER_BATCH = 7;
const MAX_TASKS = 100;
const MAX_BATCHES = 20;
const MAX_BATCH_BYTES = 16_000;
const RETRY_ATTEMPTS = 4;

function requireSectionKind(section: TaskSource['sections'][number]) {
  const permitsQuestions = ['GRAMMAR', 'READING', 'LISTENING'].includes(section.skill);
  if (
    (!permitsQuestions && section.questions.length > 0) ||
    (section.skill !== 'SPEAKING' && section.speaking.length > 0) ||
    (section.skill !== 'WRITING' && section.writing.length > 0)
  )
    throw new Error('The class exercise inventory is ambiguous.');
}

/** Do not send options, passages, recordings or private assessment material for directions. */
export function prerequisiteDirectionBatches(source: PublicSource) {
  const captured = prerequisitePublicSourceSchema.parse(source);
  for (const section of captured.sections) requireSectionKind(section);
  const tasks = captured.sections.flatMap((section) => [
    ...section.questions.map((question) => ({
      sectionId: section.id,
      taskId: question.id,
      kind: 'question' as const,
      skill: section.skill,
      prompt: question.question,
    })),
    ...section.speaking.map((prompt) => ({
      sectionId: section.id,
      taskId: prompt.id,
      kind: 'speaking' as const,
      skill: section.skill,
      prompt: prompt.targetPhrase,
      context: prompt.translation,
      taskMode: prompt.taskMode,
    })),
    ...section.writing.map((prompt) => ({
      sectionId: section.id,
      taskId: prompt.id,
      kind: 'writing' as const,
      skill: section.skill,
      prompt: prompt.task,
      context: prompt.guidance,
    })),
  ]);
  if (!tasks.length) throw new Error('The class exercise inventory is unsupported.');
  if (tasks.length > MAX_TASKS) throw new PrerequisiteCapacityError();
  const batches: Array<typeof tasks> = [];
  let batch: typeof tasks = [];
  for (const task of tasks) {
    if (Buffer.byteLength(JSON.stringify([task]), 'utf8') > MAX_BATCH_BYTES)
      throw new PrerequisiteCapacityError();
    if (
      batch.length === TASKS_PER_BATCH ||
      Buffer.byteLength(JSON.stringify([...batch, task]), 'utf8') > MAX_BATCH_BYTES
    ) {
      batches.push(batch);
      batch = [];
    }
    batch.push(task);
  }
  if (batch.length) batches.push(batch);
  return batches;
}

/** Count the parent, model calls, input/output moderation and bounded retries. */
export function prerequisiteProviderBudget(batchCount: number) {
  if (!Number.isSafeInteger(batchCount) || batchCount < 1 || batchCount > MAX_BATCHES)
    throw new Error('The class exercise inventory is unsupported.');
  return 1 + 3 * (2 + 2 * batchCount) + RETRY_ATTEMPTS;
}

function key(sectionId: string, kind: TaskKind, taskId: string) {
  return JSON.stringify([sectionId, kind, taskId]);
}

export function requirePrerequisiteDirectionBatch(
  batch: ReturnType<typeof prerequisiteDirectionBatches>[number],
  input: unknown,
  includesGuided: boolean
) {
  const value = prerequisiteDirectionBatchSchema.parse(input);
  if ((value.guided !== null) !== includesGuided)
    throw new Error('Prerequisite directions do not match the guided exercise.');
  const expected = new Set(batch.map((task) => key(task.sectionId, task.kind, task.taskId)));
  if (expected.size !== batch.length) throw new Error('The class exercise inventory is ambiguous.');
  const seen = new Set<string>();
  for (const task of value.tasks) {
    const identity = key(task.sectionId, task.kind, task.taskId);
    if (!expected.has(identity) || seen.has(identity))
      throw new Error('Prerequisite directions do not match the current exercises.');
    seen.add(identity);
  }
  if (seen.size !== expected.size)
    throw new Error('Prerequisite directions do not match the current exercises.');
  return value;
}

/** Use the same bounded public context for authoring and independent review. */
export function prerequisiteDirectionPayload(
  source: PublicSource,
  batch: ReturnType<typeof prerequisiteDirectionBatches>[number],
  includesGuided: boolean,
  candidate?: z.infer<typeof prerequisiteDirectionBatchSchema>
) {
  const captured = prerequisitePublicSourceSchema.parse(source);
  const tasks = z.array(directionInputSchema).min(1).max(TASKS_PER_BATCH).parse(batch);
  if (
    !prerequisiteDirectionBatches(captured).some((expected) => isDeepStrictEqual(expected, tasks))
  )
    throw new Error('Prerequisite directions do not match the current exercises.');
  const payload = {
    course: captured.course,
    lesson: captured.lesson,
    guided: includesGuided ? captured.teaching.guidedPractice : null,
    tasks,
    ...(candidate
      ? { candidate: requirePrerequisiteDirectionBatch(tasks, candidate, includesGuided) }
      : {}),
  };
  const text = JSON.stringify(payload);
  return requireModeratedPrerequisitePayload(text);
}

/** Prove authoring and maximum-sized review payloads fit before paid requests. */
export function preflightPrerequisiteDirections(source: PublicSource) {
  const batches = prerequisiteDirectionBatches(source);
  if (batches.length > MAX_BATCHES) throw new PrerequisiteCapacityError();
  batches.forEach((batch, index) => {
    const includesGuided = index === 0;
    prerequisiteDirectionPayload(source, batch, includesGuided);
    for (const sample of ['\\'.repeat(1000), 'ࠀ'.repeat(1000)]) {
      prerequisiteDirectionPayload(source, batch, includesGuided, {
        guided: includesGuided ? sample : null,
        tasks: batch.map(({ sectionId, taskId, kind }) => ({
          sectionId,
          taskId,
          kind,
          instruction: sample,
        })),
      });
    }
  });
  return batches;
}

/** Reject missing, duplicate, foreign or ambiguous exercise identities. */
export function requireCompletePrerequisiteDirections(source: TaskSource, input: unknown) {
  const value = prerequisiteDirectionsSchema.parse(input);
  const expected = new Set<string>();
  const sectionIds = new Set<string>();
  for (const section of source.sections) {
    requireSectionKind(section);
    if (sectionIds.has(section.id)) throw new Error('The class exercise inventory is ambiguous.');
    sectionIds.add(section.id);
    for (const [kind, items] of [
      ['question', section.questions],
      ['speaking', section.speaking],
      ['writing', section.writing],
    ] as const) {
      for (const item of items) {
        const identity = key(section.id, kind, item.id);
        if (expected.has(identity)) throw new Error('The class exercise inventory is ambiguous.');
        expected.add(identity);
      }
    }
  }
  if (!expected.size || expected.size > MAX_TASKS)
    throw new Error('The class exercise inventory is unsupported.');
  const seen = new Set<string>();
  for (const task of value.tasks) {
    const identity = key(task.sectionId, task.kind, task.taskId);
    if (!expected.has(identity) || seen.has(identity))
      throw new Error('Prerequisite directions do not match the current exercises.');
    seen.add(identity);
  }
  if (seen.size !== expected.size)
    throw new Error('Prerequisite directions do not match the current exercises.');
  return value;
}
