import { skillRequirementsSchema } from '@sotto/shared';
import { z } from 'zod';
import { OptimisticStateStore } from 'thesidedoor-core/storage/optimistic';
import type { AtomicStateBackend } from 'thesidedoor-core/storage/optimistic';
import { delegationBindingSchema } from 'thesidedoor-core/runtime/delegation';

export const preparationSchema = z
  .object({
    id: z.uuid(),
    courseId: z.string().min(1),
    userId: z.string().min(1),
    courseCreatedAt: z.number().int(),
    userCreatedAt: z.number().int(),
    instanceId: z.uuid(),
    createdAt: z.number().int(),
    availableAt: z.number().int(),
    expiresAt: z.number().int(),
    timeZone: z.string().min(1).max(100),
    deferAudio: z.boolean(),
    maxProviderRequests: z.number().int().min(1).max(256).nullable(),
    requirements: skillRequirementsSchema.optional(),
    intent: z
      .object({
        kind: z.enum(['REGENERATE', 'REPAIR']),
        classId: z.string().min(1),
        attempt: z.number().int().positive(),
        priorStatus: z.string().min(1),
        classFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        skills: z.array(z.enum(['GRAMMAR', 'READING', 'LISTENING', 'SPEAKING', 'WRITING'])),
      })
      .strict()
      .optional(),
    courseLevel: z.string().optional(),
    speechFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    selection: z
      .object({
        provider: z.string().min(1),
        model: z.string().min(1),
        endpoint: z.string().optional(),
        isolatedImage: z.string().optional(),
        credentialFingerprint: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .nullable(),
        moderationCredentialFingerprint: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .nullable()
          .optional(),
      })
      .strict(),
    grant: delegationBindingSchema,
    inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.enum([
      'QUEUED',
      'RUNNING',
      'CANCELLING',
      'CANCELLED',
      'COMPLETED',
      'FAILED',
      'UNRESOLVED',
    ]),
    classId: z.string().nullable(),
    audioEpisodeIds: z.array(z.string().min(1)).max(16),
    result: z.enum(['created', 'gated', 'done']).nullable(),
    updatedAt: z.number().int(),
    failure: z
      .enum(['generation_failed', 'source_unreadable', 'interrupted', 'expired'])
      .nullable(),
  })
  .strict();

export type ClassPreparation = z.infer<typeof preparationSchema>;
const activePreparation = (value: ClassPreparation) =>
  ['QUEUED', 'RUNNING', 'CANCELLING', 'UNRESOLVED'].includes(value.status);

export class PreparationConflictError extends Error {
  constructor(message = 'This course already has an active preparation task.') {
    super(message);
    this.name = 'PreparationConflictError';
  }
}

/** The database caller owns the transaction spanning this state and course/outbox rows. */
export function preparationStore(backend: AtomicStateBackend) {
  return new OptimisticStateStore<ClassPreparation | null>({
    backend,
    parse: (value) => preparationSchema.nullable().parse(value),
    initial: () => null,
  });
}

/** Replays retain the original identity. A new request cannot replace uncertain work. */
export function admitPreparation(current: ClassPreparation | null, proposed: ClassPreparation) {
  const next = preparationSchema.parse(proposed);
  if (!current || !activePreparation(current)) return next;
  if (
    current.userId === next.userId &&
    current.courseCreatedAt === next.courseCreatedAt &&
    current.userCreatedAt === next.userCreatedAt &&
    current.instanceId === next.instanceId &&
    current.inputFingerprint === next.inputFingerprint &&
    current.deferAudio === next.deferAudio &&
    current.maxProviderRequests === next.maxProviderRequests &&
    current.timeZone === next.timeZone &&
    JSON.stringify(current.selection) === JSON.stringify(next.selection) &&
    (next.deferAudio
      ? current.availableAt === next.availableAt
      : current.availableAt <= next.availableAt) &&
    current.status !== 'UNRESOLVED'
  )
    return current;
  throw new PreparationConflictError();
}

type PreparationLifecycle = Pick<
  ClassPreparation,
  'status' | 'audioEpisodeIds' | 'expiresAt' | 'availableAt' | 'updatedAt' | 'failure'
>;

export function startPreparation<T extends PreparationLifecycle>(current: T, now: number): T {
  if (current.status === 'CANCELLING' && current.audioEpisodeIds.length === 0)
    return { ...current, status: 'CANCELLED', updatedAt: now };
  if (current.status === 'RUNNING')
    return { ...current, status: 'UNRESOLVED', failure: 'interrupted', updatedAt: now };
  if (current.status !== 'QUEUED') return current;
  if (now < current.availableAt) throw new PreparationConflictError('Preparation is not due yet.');
  if (now >= current.expiresAt)
    return { ...current, status: 'FAILED', failure: 'expired', updatedAt: now };
  return { ...current, status: 'RUNNING', updatedAt: now };
}

export function cancelPreparation<T extends PreparationLifecycle>(current: T, now: number): T {
  if (current.status === 'COMPLETED' && current.audioEpisodeIds.length > 0)
    return { ...current, status: 'CANCELLING', updatedAt: now };
  if (current.status === 'QUEUED') return { ...current, status: 'CANCELLED', updatedAt: now };
  if (current.status === 'RUNNING') return { ...current, status: 'CANCELLING', updatedAt: now };
  if (current.status === 'UNRESOLVED')
    throw new PreparationConflictError(
      'This task needs execution recovery before it can be replaced.'
    );
  return current;
}
