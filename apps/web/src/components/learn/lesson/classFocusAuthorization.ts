import { classPreludeResponseSchema, classProgressRecoverySchema } from '@sotto/shared';
import { z } from 'zod';

const bindingSchema = z
  .object({
    classId: z.string().min(1),
    attempt: z.number().int().positive().safe(),
    taskMaterialRevision: z.string().regex(/^[a-f0-9]{64}$/),
    replay: z.boolean(),
  })
  .strict();

export type ClassFocusBinding = z.infer<typeof bindingSchema>;

/** Compare newly read authority with the exact class and lesson already displayed. */
export function classFocusAuthorizationMatches(input: {
  binding: unknown;
  originalPrelude: unknown;
  currentPrelude: unknown;
  currentProgress: unknown;
}): boolean {
  const binding = bindingSchema.safeParse(input.binding);
  const original = classPreludeResponseSchema.safeParse(input.originalPrelude);
  const current = classPreludeResponseSchema.safeParse(input.currentPrelude);
  const progress = classProgressRecoverySchema.safeParse(input.currentProgress);
  if (!binding.success || !original.success || !current.success || !progress.success) return false;
  if (
    progress.data.classId !== binding.data.classId ||
    progress.data.attempt !== binding.data.attempt ||
    progress.data.taskMaterialRevision !== binding.data.taskMaterialRevision
  )
    return false;
  const replay = binding.data.replay;
  if (
    replay
      ? !['SUBMITTED', 'PASSED', 'FAILED'].includes(progress.data.status)
      : !['AVAILABLE', 'IN_PROGRESS'].includes(progress.data.status)
  )
    return false;
  if (original.data.kind === 'REPLAY') return replay && current.data.kind === 'REPLAY';
  if (replay) return false;
  if (original.data.kind === 'NOT_REQUIRED') return current.data.kind === 'NOT_REQUIRED';
  if (original.data.kind === 'BASE')
    return (
      original.data.acknowledged &&
      current.data.kind === 'BASE' &&
      current.data.acknowledged &&
      JSON.stringify(original.data) === JSON.stringify(current.data)
    );
  if (original.data.kind === 'ADDENDUM')
    return (
      original.data.status === 'READY' &&
      original.data.acknowledged === true &&
      current.data.kind === 'ADDENDUM' &&
      current.data.status === 'READY' &&
      current.data.acknowledged === true &&
      JSON.stringify(original.data) === JSON.stringify(current.data)
    );
  return false;
}
