'use client';

import { z } from 'zod';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

interface ProgressPatch {
  answers?: Record<string, number>;
  writingDrafts?: Record<string, string>;
}
interface ProgressQueue {
  revision: number;
  pending: ProgressPatch | null;
  inFlight: ProgressPatch | null;
  latest: ProgressPatch;
  saving: boolean;
  reconciling: boolean;
  epoch: number;
  error: string;
  timer: ReturnType<typeof setTimeout> | null;
  listeners: Set<(error: string) => void>;
}
const cachedProgressSchema = z.object({
  revision: z.number().int().nonnegative(),
  pending: z
    .object({
      answers: z.record(z.string(), z.number().int().min(0).max(3)).optional(),
      writingDrafts: z.record(z.string(), z.string()).optional(),
    })
    .nullable(),
  latest: z
    .object({
      answers: z.record(z.string(), z.number().int().min(0).max(3)).optional(),
      writingDrafts: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
  error: z.string().optional(),
});
const queues = new Map<string, ProgressQueue>();
const keyFor = (endpoint: string, material: string) => `${endpoint}/${material}`;
const merge = (left: ProgressPatch, right: ProgressPatch): ProgressPatch => ({
  ...(left.answers || right.answers ? { answers: { ...left.answers, ...right.answers } } : {}),
  ...(left.writingDrafts || right.writingDrafts
    ? { writingDrafts: { ...left.writingDrafts, ...right.writingDrafts } }
    : {}),
});

function retain(key: string, queue: ProgressQueue) {
  try {
    sessionStorage.setItem(
      `learning:${key}`,
      JSON.stringify({
        revision: queue.revision,
        pending: queue.inFlight ? merge(queue.inFlight, queue.pending ?? {}) : queue.pending,
        latest: queue.latest,
        error: queue.error,
      })
    );
  } catch {
    /* In-memory work remains available when browser storage is unavailable. */
  }
}

function getQueue(endpoint: string, revision: number, material: string): ProgressQueue {
  const key = keyFor(endpoint, material);
  const existing = queues.get(key);
  if (existing) {
    if (revision > existing.revision && (existing.pending || existing.inFlight || existing.error))
      existing.latest = merge(existing.inFlight ?? {}, existing.pending ?? {});
    if (!existing.pending && !existing.saving && !existing.error && revision >= existing.revision) {
      existing.revision = revision;
      existing.latest = {};
    }
    return existing;
  }
  const queue: ProgressQueue = {
    revision,
    pending: null,
    inFlight: null,
    latest: {},
    saving: false,
    reconciling: false,
    epoch: 0,
    error: '',
    timer: null,
    listeners: new Set(),
  };
  try {
    const parsed = cachedProgressSchema.safeParse(
      JSON.parse(sessionStorage.getItem(`learning:${key}`) ?? 'null')
    );
    const stored = parsed.success ? parsed.data : null;
    if (stored?.pending) {
      queue.revision = stored.revision!;
      queue.pending = stored.pending;
      queue.latest =
        revision > stored.revision ? stored.pending : (stored.latest ?? stored.pending);
      queue.error =
        stored.error ||
        'Local edits are waiting for confirmation. Check saved progress before continuing.';
    }
  } catch {
    /* Ignore unusable browser cache; the server remains authoritative. */
  }
  queues.set(key, queue);
  return queue;
}

export function retainedLearningProgress(
  endpoint: string,
  initial: ProgressPatch,
  revision = 0,
  material = ''
): ProgressPatch {
  return merge(initial, getQueue(endpoint, revision, material).latest);
}

function publish(key: string, queue: ProgressQueue, error: string) {
  queue.error = error;
  retain(key, queue);
  queue.listeners.forEach((listener) => listener(error));
}

async function flush(endpoint: string, material: string, queue: ProgressQueue) {
  if (queue.saving || queue.reconciling || !queue.pending || queue.error) return;
  if (queue.timer) clearTimeout(queue.timer);
  queue.timer = null;
  const key = keyFor(endpoint, material);
  const patch = queue.pending;
  queue.pending = null;
  queue.saving = true;
  queue.inFlight = patch;
  retain(key, queue);
  try {
    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ ...patch, expectedRevision: queue.revision }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
      progressRevision?: number;
    };
    if (!response.ok) throw new Error(result.error ?? 'Your progress could not be saved.');
    if (
      typeof result.progressRevision !== 'number' ||
      !Number.isSafeInteger(result.progressRevision)
    )
      throw new Error(
        'Your progress save could not be confirmed. Check saved progress before continuing.'
      );
    queue.revision = result.progressRevision;
    publish(key, queue, '');
  } catch (failure: unknown) {
    queue.pending = merge(patch, queue.pending ?? {});
    publish(
      key,
      queue,
      failure instanceof Error ? failure.message : 'Your progress could not be saved.'
    );
  } finally {
    queue.inFlight = null;
    queue.saving = false;
    retain(key, queue);
    if (queue.pending && !queue.error) void flush(endpoint, material, queue);
  }
}

interface SavedProgress {
  status?: string;
  attempt?: number;
  submitted?: boolean;
  submissionResult?: unknown;
  progressRevision?: number;
  learnerAnswers?: Record<string, number>;
  writingDrafts?: Record<string, string>;
  items?: { id: string }[];
  prompts?: { id: string }[];
  writingPrompts?: { id: string }[];
  sections?: { questions: { id: string }[]; writingPrompts: { id: string }[] }[];
}

/** Read the current revision before asking the learner to replace competing edits. */
export async function reconcileLearningProgress(
  endpoint: string,
  material = '',
  overwrite = false
): Promise<'saved' | 'conflict'> {
  const key = keyFor(endpoint, material);
  const queue = queues.get(key);
  if (!queue || queue.saving || queue.reconciling)
    throw new Error('Wait for the current progress save to finish.');
  const epoch = queue.epoch;
  queue.reconciling = true;
  let applied = false;
  try {
    const response = await fetch(endpoint);
    if (queue.epoch !== epoch)
      throw new Error(
        'Your local edits changed while checking saved progress. Check again to preserve the latest edits.'
      );
    const current = (await response.json()) as SavedProgress;
    if (queue.epoch !== epoch)
      throw new Error('Your local edits changed while checking saved progress. Check again.');
    if (!response.ok)
      throw new Error('Saved progress could not be checked. Your local edits are retained.');
    if (
      !Number.isSafeInteger(current.progressRevision) ||
      current.submitted ||
      current.submissionResult ||
      ![
        'AVAILABLE',
        'IN_PROGRESS',
        'ready',
        'ready_full',
        'ready_writing',
        'ready_speaking',
      ].includes(current.status ?? '') ||
      (material && String(current.attempt ?? 1) !== material)
    )
      throw new Error('This learning material changed or finished. Your local edits are retained.');
    const questionIds = new Set(
      current.sections?.flatMap((section) => section.questions.map((question) => question.id)) ??
        current.items?.map((item) => item.id) ??
        []
    );
    const writingIds = new Set(
      current.sections?.flatMap((section) => section.writingPrompts.map((prompt) => prompt.id)) ??
        current.writingPrompts?.map((prompt) => prompt.id) ??
        current.prompts?.map((prompt) => prompt.id) ??
        []
    );
    const pending = queue.pending ?? {};
    if (
      Object.keys(pending.answers ?? {}).some((id) => !questionIds.has(id)) ||
      Object.keys(pending.writingDrafts ?? {}).some((id) => !writingIds.has(id))
    )
      throw new Error('Your local edits belong to different learning material. They are retained.');
    const matches =
      Object.entries(pending.answers ?? {}).every(
        ([id, value]) => current.learnerAnswers?.[id] === value
      ) &&
      Object.entries(pending.writingDrafts ?? {}).every(
        ([id, value]) => current.writingDrafts?.[id] === value
      );
    if (!matches && !overwrite) return 'conflict';
    queue.revision = current.progressRevision!;
    if (matches) queue.pending = null;
    publish(key, queue, '');
    applied = true;
    return 'saved';
  } finally {
    queue.reconciling = false;
    await flush(endpoint, material, queue);
    if (applied && queue.error) throw new Error(queue.error);
    if (!queue.error && queue.pending) retain(key, queue);
  }
}

/** One queue owns every writer for a session and attempt. Hydration never counts as a learner edit. */
export function useLearningProgress(
  endpoint: string,
  progress: ProgressPatch,
  enabled = true,
  initialRevision = 0,
  material = ''
): string {
  const activeQueue = enabled ? getQueue(endpoint, initialRevision, material) : undefined;
  const subscribe = useCallback(
    (notify: () => void) => {
      activeQueue?.listeners.add(notify);
      return () => {
        activeQueue?.listeners.delete(notify);
      };
    },
    [activeQueue]
  );
  const error = useSyncExternalStore(
    subscribe,
    () => activeQueue?.error ?? '',
    () => ''
  );
  const body = JSON.stringify(progress);
  const previous = useRef<{ key: string; body: string } | null>(null);
  useEffect(() => {
    if (!enabled) {
      previous.current = null;
      return;
    }
    const queue = getQueue(endpoint, initialRevision, material);
    if (!queue.pending && !queue.saving && !queue.error)
      queue.revision = Math.max(queue.revision, initialRevision);
    const leave = () => {
      void flush(endpoint, material, queue);
    };
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      void flush(endpoint, material, queue);
    };
  }, [endpoint, enabled, initialRevision, material]);
  useEffect(() => {
    if (!enabled) return;
    const key = keyFor(endpoint, material);
    const queue = getQueue(endpoint, initialRevision, material);
    const patch = JSON.parse(body) as ProgressPatch;
    if (!previous.current || previous.current.key !== key) {
      previous.current = { key, body };
      return;
    }
    const before = JSON.parse(previous.current.body) as ProgressPatch;
    previous.current = { key, body };
    const edits: ProgressPatch = {};
    if (patch.answers)
      edits.answers = Object.fromEntries(
        Object.entries(patch.answers).filter(([id, value]) => before.answers?.[id] !== value)
      );
    if (patch.writingDrafts)
      edits.writingDrafts = Object.fromEntries(
        Object.entries(patch.writingDrafts).filter(
          ([id, value]) => before.writingDrafts?.[id] !== value
        )
      );
    if (Object.values(edits).every((entries) => !Object.keys(entries).length)) return;
    queue.epoch += 1;
    queue.latest = merge(queue.latest, edits);
    queue.pending = merge(queue.pending ?? {}, edits);
    retain(key, queue);
    if (queue.timer) clearTimeout(queue.timer);
    queue.timer = setTimeout(() => void flush(endpoint, material, queue), 300);
  }, [endpoint, body, enabled, material, initialRevision]);
  return error;
}
