'use client';

import { z } from 'zod';
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

interface ProgressPatch {
  answers?: Record<string, number>;
  writingDrafts?: Record<string, string>;
}
export interface ClassProgressBinding {
  expectedAttempt: number;
  taskMaterialRevision: string;
}
interface AnswerContext {
  question: string;
  option: string;
}
interface ProgressQueue {
  revision: number;
  pending: ProgressPatch | null;
  inFlight: ProgressPatch | null;
  latest: ProgressPatch;
  saving: boolean;
  flushTask: Promise<void> | null;
  reconciling: boolean;
  epoch: number;
  error: string;
  timer: ReturnType<typeof setTimeout> | null;
  listeners: Set<(error: string) => void>;
  binding: ClassProgressBinding | null;
  bindingError: string;
  underlyingError: string;
  answerContext: Record<string, AnswerContext>;
  storageError: string;
}
const bindingSchema = z.object({
  expectedAttempt: z.number().int().positive().safe(),
  taskMaterialRevision: z.string().min(1),
});
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
  binding: bindingSchema.nullable().optional(),
  bindingError: z.string().optional(),
  underlyingError: z.string().optional(),
  answerContext: z
    .record(z.string(), z.object({ question: z.string(), option: z.string() }))
    .optional(),
});
const queues = new Map<string, ProgressQueue>();
const pausedClassEndpoints = new Map<string, Set<symbol>>();
const quarantinedClassEndpoints = new Set<string>();
const classHoldGeneration = new Map<string, number>();
const verifiedClassBindings = new Map<string, ClassProgressBinding>();
const queueMessage = (queue: ProgressQueue) =>
  [queue.error, queue.storageError].filter(Boolean).join(' ');
const keyFor = (endpoint: string, material: string) => `${endpoint}/${material}`;
const isPaused = (endpoint: string) => Boolean(pausedClassEndpoints.get(endpoint)?.size);
const isHeld = (endpoint: string) => isPaused(endpoint) || quarantinedClassEndpoints.has(endpoint);

/** Capture the current class authority before starting a multi-step operation. */
export function captureLearningAuthority(endpoint: string): number | null {
  return isHeld(endpoint) ? null : (classHoldGeneration.get(endpoint) ?? 0);
}

export function learningAuthorityIsCurrent(endpoint: string, generation: number): boolean {
  return !isHeld(endpoint) && (classHoldGeneration.get(endpoint) ?? 0) === generation;
}

export function learningBindingIsCurrent(
  endpoint: string,
  binding: ClassProgressBinding | null | undefined
): boolean {
  if (isHeld(endpoint)) return false;
  const verified = verifiedClassBindings.get(endpoint);
  return (
    !verified ||
    Boolean(
      binding &&
      binding.expectedAttempt === verified.expectedAttempt &&
      binding.taskMaterialRevision === verified.taskMaterialRevision
    )
  );
}

/** Keep unverified work blocked across component unmounts in this browser tab. */
export function quarantineClassLearningProgress(endpoint: string): void {
  quarantinedClassEndpoints.add(endpoint);
  classHoldGeneration.set(endpoint, (classHoldGeneration.get(endpoint) ?? 0) + 1);
  for (const [key, queue] of queues) {
    if (!key.startsWith(`${endpoint}/`)) continue;
    queue.epoch += 1;
    if (queue.timer) clearTimeout(queue.timer);
    queue.timer = null;
    retain(key, queue);
  }
}

function verifyClassLearningProgress(
  endpoint: string,
  token: symbol,
  generation: number,
  binding: ClassProgressBinding
): void {
  const valid = bindingSchema.safeParse(binding);
  if (
    !pausedClassEndpoints.get(endpoint)?.has(token) ||
    classHoldGeneration.get(endpoint) !== generation ||
    !valid.success ||
    !/^[a-f0-9]{64}$/.test(valid.data.taskMaterialRevision)
  )
    throw new Error('The class could not be verified. Your local edits are retained.');
  verifiedClassBindings.set(endpoint, valid.data);
  for (const [key, queue] of queues) {
    if (!key.startsWith(`${endpoint}/`)) continue;
    enforceVerifiedBinding(endpoint, key, queue);
  }
  quarantinedClassEndpoints.delete(endpoint);
}

/** Hold new saves while class authority is being checked; in-flight saves may settle. */
export function pauseClassLearningProgress(endpoint: string): (() => void) & {
  verify: (binding: ClassProgressBinding) => void;
} {
  const token = Symbol();
  const generation = (classHoldGeneration.get(endpoint) ?? 0) + 1;
  classHoldGeneration.set(endpoint, generation);
  const pauses = pausedClassEndpoints.get(endpoint) ?? new Set<symbol>();
  pauses.add(token);
  pausedClassEndpoints.set(endpoint, pauses);
  for (const [key, queue] of queues) {
    if (!key.startsWith(`${endpoint}/`)) continue;
    queue.epoch += 1;
    if (queue.timer) clearTimeout(queue.timer);
    queue.timer = null;
  }
  let verified = false;
  const release = () => {
    const current = pausedClassEndpoints.get(endpoint);
    if (!current?.has(token)) return;
    if (!verified && classHoldGeneration.get(endpoint) === generation)
      quarantineClassLearningProgress(endpoint);
    if (!current.delete(token) || current.size) return;
    pausedClassEndpoints.delete(endpoint);
    for (const [key, queue] of queues) {
      if (key.startsWith(`${endpoint}/`))
        void flush(endpoint, key.slice(endpoint.length + 1), queue);
    }
  };
  release.verify = (binding: ClassProgressBinding) => {
    if (verified) throw new Error('The class check has already been used.');
    verifyClassLearningProgress(endpoint, token, generation, binding);
    verified = true;
  };
  return release;
}
const merge = (left: ProgressPatch, right: ProgressPatch): ProgressPatch => ({
  ...(left.answers || right.answers ? { answers: { ...left.answers, ...right.answers } } : {}),
  ...(left.writingDrafts || right.writingDrafts
    ? { writingDrafts: { ...left.writingDrafts, ...right.writingDrafts } }
    : {}),
});

function retain(key: string, queue: ProgressQueue) {
  const previousError = queue.storageError;
  try {
    sessionStorage.setItem(
      `learning:${key}`,
      JSON.stringify({
        revision: queue.revision,
        pending: queue.inFlight ? merge(queue.inFlight, queue.pending ?? {}) : queue.pending,
        latest: queue.latest,
        error: queue.error,
        binding: queue.binding,
        bindingError: queue.bindingError,
        underlyingError: queue.underlyingError,
        answerContext: queue.answerContext,
      })
    );
    queue.storageError = '';
  } catch {
    queue.storageError =
      queue.pending || queue.inFlight
        ? 'This browser could not keep a local copy. Keep this page open and copy your work until it is saved.'
        : '';
  }
  if (queue.storageError !== previousError)
    queueMicrotask(() => queue.listeners.forEach((listener) => listener(queueMessage(queue))));
}

function getQueue(
  endpoint: string,
  revision: number,
  material: string,
  binding?: ClassProgressBinding | null
): ProgressQueue {
  const key = keyFor(endpoint, material);
  const existing = queues.get(key);
  if (existing) {
    if (binding !== undefined) bindClassQueue(key, existing, binding);
    enforceVerifiedBinding(endpoint, key, existing);
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
    flushTask: null,
    reconciling: false,
    epoch: 0,
    error: '',
    timer: null,
    listeners: new Set(),
    binding: null,
    bindingError: '',
    underlyingError: '',
    answerContext: {},
    storageError: '',
  };
  try {
    const parsed = cachedProgressSchema.safeParse(
      JSON.parse(sessionStorage.getItem(`learning:${key}`) ?? 'null')
    );
    const stored = parsed.success ? parsed.data : null;
    if (stored?.pending) {
      queue.binding = stored.binding ?? null;
      queue.answerContext = stored.answerContext ?? {};
      queue.bindingError = stored.bindingError ?? '';
      queue.revision = stored.revision!;
      queue.pending = stored.pending;
      queue.latest =
        revision > stored.revision ? stored.pending : (stored.latest ?? stored.pending);
      queue.error =
        stored.error ||
        'Local edits are waiting for confirmation. Check saved progress before continuing.';
      queue.underlyingError = stored.underlyingError ?? (stored.bindingError ? '' : queue.error);
    }
  } catch {
    /* Ignore unusable browser cache; the server remains authoritative. */
  }
  queues.set(key, queue);
  if (binding !== undefined) bindClassQueue(key, queue, binding);
  enforceVerifiedBinding(endpoint, key, queue);
  return queue;
}

function enforceVerifiedBinding(endpoint: string, key: string, queue: ProgressQueue) {
  const current = verifiedClassBindings.get(endpoint);
  if (!current || (!queue.pending && !queue.inFlight && !queue.underlyingError)) return;
  if (
    queue.binding?.expectedAttempt === current.expectedAttempt &&
    queue.binding.taskMaterialRevision === current.taskMaterialRevision
  )
    return;
  queue.bindingError =
    'Class material changed or could not be verified. Your local edits are retained.';
  queue.error = queue.bindingError;
  retain(key, queue);
}

function bindClassQueue(key: string, queue: ProgressQueue, binding: ClassProgressBinding | null) {
  const valid = bindingSchema.safeParse(binding);
  const next = valid.success ? valid.data : null;
  const same =
    next &&
    queue.binding &&
    next.expectedAttempt === queue.binding.expectedAttempt &&
    next.taskMaterialRevision === queue.binding.taskMaterialRevision;
  if (same && queue.bindingError) {
    queue.bindingError = '';
    queue.error = queue.underlyingError;
    retain(key, queue);
  } else if (!same && (queue.pending || queue.inFlight || queue.underlyingError)) {
    queue.bindingError =
      'Class material changed or could not be verified. Your local edits are retained.';
    queue.error = queue.bindingError;
  } else if (!same) {
    queue.binding = next;
    queue.bindingError = next
      ? ''
      : 'Class material could not be verified. Your local edits are retained.';
    queue.error = queue.bindingError;
  }
  if (queue.bindingError) retain(key, queue);
}

export function retainedLearningProgress(
  endpoint: string,
  initial: ProgressPatch,
  revision = 0,
  material = '',
  binding?: ClassProgressBinding | null
): ProgressPatch {
  const queue = getQueue(endpoint, revision, material, binding);
  return queue.bindingError ? initial : merge(initial, queue.latest);
}

export function retainedClassWork(endpoint: string, currentAttempt: string) {
  const prefix = `${endpoint}/`;
  const keys = new Set([...queues.keys()].filter((key) => key.startsWith(prefix)));
  try {
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(`learning:${prefix}`)) keys.add(key.slice('learning:'.length));
    }
  } catch {
    // The in-memory queue can still contain work when storage is unavailable.
  }
  const pendingWork = [...keys].flatMap((key) => {
    const attempt = key.slice(prefix.length);
    if (!/^\d+$/.test(attempt)) return [];
    const queue = queues.get(key);
    if (queue) {
      if (
        attempt === currentAttempt &&
        !queue.bindingError &&
        !queue.storageError &&
        !isHeld(endpoint)
      )
        return [];
      const pending = queue.inFlight ? merge(queue.inFlight, queue.pending ?? {}) : queue.pending;
      return pending
        ? [
            {
              attempt,
              pending,
              answerContext: queue.answerContext,
              blocksCurrent: attempt === currentAttempt && Boolean(queue.bindingError),
            },
          ]
        : [];
    }
    if (attempt === currentAttempt) return [];
    try {
      const stored = cachedProgressSchema.safeParse(
        JSON.parse(sessionStorage.getItem(`learning:${key}`) ?? 'null')
      );
      return stored.success && stored.data.pending
        ? [
            {
              attempt,
              pending: stored.data.pending,
              answerContext: stored.data.answerContext ?? {},
              blocksCurrent: false,
            },
          ]
        : [];
    } catch {
      return [];
    }
  });
  const archived: typeof pendingWork = [];
  try {
    const archivePrefix = `learning-archive:${prefix}`;
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (!key?.startsWith(archivePrefix)) continue;
      const attempt = key.slice(archivePrefix.length).split('/')[0];
      const stored = cachedProgressSchema.safeParse(
        JSON.parse(sessionStorage.getItem(key) ?? 'null')
      );
      if (/^\d+$/.test(attempt) && stored.success && stored.data.pending)
        archived.push({
          attempt,
          pending: stored.data.pending,
          answerContext: stored.data.answerContext ?? {},
          blocksCurrent: false,
        });
    }
  } catch {
    // Existing in-memory and storage entries remain unchanged.
  }
  return [...pendingWork, ...archived];
}

export function classProgressBlocked(endpoint: string, attempt: string): boolean {
  return Boolean(queues.get(keyFor(endpoint, attempt))?.bindingError);
}

/** Keep a copy of an unverified queue before allowing new material to be used. */
export function archiveClassWork(endpoint: string, attempt: string): void {
  if (isHeld(endpoint)) throw new Error('Wait for the class check to finish.');
  const key = keyFor(endpoint, attempt);
  const queue = queues.get(key);
  if (queue?.inFlight || queue?.reconciling)
    throw new Error('Wait for the current save to finish.');
  const stored = cachedProgressSchema.safeParse(
    queue
      ? {
          revision: queue.revision,
          pending: queue.pending,
          latest: queue.latest,
          binding: queue.binding,
          answerContext: queue.answerContext,
        }
      : JSON.parse(sessionStorage.getItem(`learning:${key}`) ?? 'null')
  );
  if (!stored.success || !stored.data.pending)
    throw new Error('The retained edits could not be found.');
  const archivePrefix = `learning-archive:${key}/${Date.now()}`;
  let archiveKey = archivePrefix;
  let suffix = 0;
  while (sessionStorage.getItem(archiveKey) !== null) archiveKey = `${archivePrefix}-${++suffix}`;
  sessionStorage.setItem(archiveKey, JSON.stringify(stored.data));
  sessionStorage.removeItem(`learning:${key}`);
  if (queue?.timer) clearTimeout(queue.timer);
  queues.delete(key);
}

export function discardClassWork(endpoint: string, attempt: string): void {
  if (isHeld(endpoint)) throw new Error('Wait for the class check to finish.');
  const key = keyFor(endpoint, attempt);
  const queue = queues.get(key);
  if (queue?.inFlight || queue?.reconciling)
    throw new Error('Wait for the current save to finish.');
  try {
    sessionStorage.removeItem(`learning:${key}`);
  } catch {
    let readable = false;
    try {
      sessionStorage.getItem(`learning:${key}`);
      readable = true;
    } catch {
      // The store is unavailable. A previously stored copy may reappear if access returns.
    }
    if (readable) throw new Error('The browser copy could not be removed.');
  }
  if (queue?.timer) clearTimeout(queue.timer);
  queues.delete(key);
}

function publish(key: string, queue: ProgressQueue, error: string) {
  queue.underlyingError = error;
  queue.error = queue.bindingError || error;
  retain(key, queue);
  queue.listeners.forEach((listener) => listener(queueMessage(queue)));
}

function flush(endpoint: string, material: string, queue: ProgressQueue): Promise<void> {
  if (isHeld(endpoint)) return Promise.resolve();
  enforceVerifiedBinding(endpoint, keyFor(endpoint, material), queue);
  if (queue.flushTask) return queue.flushTask;
  if (queue.reconciling || !queue.pending || queue.error) return Promise.resolve();
  queue.flushTask = flushPending(endpoint, material, queue).finally(() => {
    queue.flushTask = null;
    if (queue.pending && !queue.error && !queue.reconciling && !isHeld(endpoint))
      queueMicrotask(() => void flush(endpoint, material, queue));
  });
  return queue.flushTask;
}

async function flushPending(endpoint: string, material: string, queue: ProgressQueue) {
  const key = keyFor(endpoint, material);
  while (queue.pending && !queue.error && !queue.reconciling && !isHeld(endpoint)) {
    if (queue.timer) clearTimeout(queue.timer);
    queue.timer = null;
    const patch = queue.pending;
    queue.pending = null;
    queue.saving = true;
    queue.inFlight = patch;
    retain(key, queue);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        signal: controller.signal,
        body: JSON.stringify({ ...patch, expectedRevision: queue.revision, ...queue.binding }),
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
        controller.signal.aborted
          ? 'Progress save timed out. The result is unknown; your local edits are retained.'
          : failure instanceof Error
            ? failure.message
            : 'Your progress could not be saved.'
      );
    } finally {
      clearTimeout(timeout);
      queue.inFlight = null;
      queue.saving = false;
      retain(key, queue);
    }
  }
}

/** Confirm all queued edits before an operation replaces learning material. */
export async function flushLearningProgress(
  endpoint: string,
  material = '',
  initialRevision = 0
): Promise<number> {
  const queue = getQueue(endpoint, initialRevision, material);
  if (isHeld(endpoint)) throw new Error('Wait for the class check to finish.');
  if (queue.reconciling) throw new Error('Wait for the saved progress check to finish.');
  await flush(endpoint, material, queue);
  if (isHeld(endpoint)) throw new Error('Wait for the class check to finish.');
  if (queue.error) throw new Error(queue.error);
  if (queue.pending || queue.saving || queue.reconciling)
    throw new Error('Wait for your progress to finish saving.');
  return queue.revision;
}

interface SavedProgress {
  status?: string;
  attempt?: number;
  taskMaterialRevision?: string | null;
  submitted?: boolean;
  submissionResult?: unknown;
  progressRevision?: number;
  learnerAnswers?: Record<string, number>;
  writingDrafts?: Record<string, string>;
  items?: { id: string }[];
  prompts?: { id: string }[];
  writingPrompts?: { id: string }[];
  cards?: { id: string; feedback: unknown }[];
  receipt?: unknown;
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
  if (isHeld(endpoint)) throw new Error('Wait for the class check to finish.');
  if (!queue || queue.saving || queue.reconciling)
    throw new Error('Wait for the current progress save to finish.');
  if (queue.bindingError) throw new Error(queue.bindingError);
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
      current.receipt ||
      ![
        'AVAILABLE',
        'IN_PROGRESS',
        'ready',
        'ready_full',
        'ready_writing',
        'ready_speaking',
        'ready_vocabulary',
      ].includes(current.status ?? '') ||
      (material && String(current.attempt ?? 1) !== material)
    )
      throw new Error('This learning material changed or finished. Your local edits are retained.');
    if (
      queue.bindingError ||
      (queue.binding &&
        (current.attempt !== queue.binding.expectedAttempt ||
          current.taskMaterialRevision !== queue.binding.taskMaterialRevision))
    )
      throw new Error(
        'This class material changed or could not be verified. Your local edits are retained.'
      );
    const questionIds = new Set(
      current.sections?.flatMap((section) => section.questions.map((question) => question.id)) ??
        current.items?.map((item) => item.id) ??
        []
    );
    const writingIds = new Set(
      current.sections?.flatMap((section) => section.writingPrompts.map((prompt) => prompt.id)) ??
        current.writingPrompts?.map((prompt) => prompt.id) ??
        current.prompts?.map((prompt) => prompt.id) ??
        current.cards?.filter((card) => !card.feedback).map((card) => card.id) ??
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
  material = '',
  binding?: ClassProgressBinding | null,
  answerContext?: Record<string, AnswerContext>
): string {
  const scoped = binding !== undefined;
  const expectedAttempt = binding?.expectedAttempt;
  const taskMaterialRevision = binding?.taskMaterialRevision;
  const stableBinding = useMemo(
    () =>
      scoped
        ? expectedAttempt && taskMaterialRevision
          ? { expectedAttempt, taskMaterialRevision }
          : null
        : undefined,
    [scoped, expectedAttempt, taskMaterialRevision]
  );
  const activeQueue = enabled
    ? getQueue(endpoint, initialRevision, material, stableBinding)
    : undefined;
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
    () => (activeQueue ? queueMessage(activeQueue) : ''),
    () => ''
  );
  const body = JSON.stringify(progress);
  const contextBody = JSON.stringify(answerContext ?? {});
  const previous = useRef<{ key: string; body: string; queue: ProgressQueue } | null>(null);
  useEffect(() => {
    if (!enabled) {
      previous.current = null;
      return;
    }
    const queue = getQueue(endpoint, initialRevision, material, stableBinding);
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
  }, [endpoint, enabled, initialRevision, material, stableBinding, activeQueue]);
  useEffect(() => {
    if (!enabled) return;
    const key = keyFor(endpoint, material);
    const queue = getQueue(endpoint, initialRevision, material, stableBinding);
    if (
      queue.bindingError &&
      (!stableBinding ||
        stableBinding.expectedAttempt !== queue.binding?.expectedAttempt ||
        stableBinding.taskMaterialRevision !== queue.binding.taskMaterialRevision)
    )
      return;
    const patch = JSON.parse(body) as ProgressPatch;
    if (!previous.current || previous.current.key !== key || previous.current.queue !== queue) {
      previous.current = { key, body, queue };
      return;
    }
    const before = JSON.parse(previous.current.body) as ProgressPatch;
    previous.current = { key, body, queue };
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
    const context = JSON.parse(contextBody) as Record<string, AnswerContext>;
    for (const id of Object.keys(edits.answers ?? {})) {
      if (context[id]) queue.answerContext[id] = context[id];
    }
    queue.epoch += 1;
    queue.latest = merge(queue.latest, edits);
    queue.pending = merge(queue.pending ?? {}, edits);
    retain(key, queue);
    if (queue.timer) clearTimeout(queue.timer);
    queue.timer = setTimeout(() => void flush(endpoint, material, queue), 300);
  }, [endpoint, body, contextBody, enabled, material, initialRevision, stableBinding, activeQueue]);
  return error;
}
