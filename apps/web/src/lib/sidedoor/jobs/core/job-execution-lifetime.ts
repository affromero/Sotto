import { randomUUID } from 'node:crypto';
import { JobExecutionJournal, runJobExecution } from 'thesidedoor-core/runtime/outbox';
import { openExecutionLocation } from 'thesidedoor-core/storage';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { resolveSottoExecutionDirectory } from './execution-directory';
import { sottoJobOutbox } from './job-delivery';
export { resolveSottoExecutionDirectory } from './execution-directory';

const executorId = randomUUID();
type ExecutionBinding = { id: string; parentId: string; fingerprint: string; executorId: string };
export type SottoJobExecutionCapability = object;
export type SottoJobExecutionOperation = object;
type CapabilityState = {
  binding: ExecutionBinding;
  live: boolean;
  signal: AbortSignal;
  workerSignal: AbortSignal;
  controller: AbortController;
  markCleanupUnconfirmed: () => void;
  uncertain: boolean;
  cancelledAtClose: boolean;
  closing?: Promise<void>;
  pending: Set<Promise<void>>;
  failures: unknown[];
};
const capabilities = new WeakMap<SottoJobExecutionCapability, CapabilityState>();
const operations = new WeakMap<
  SottoJobExecutionOperation,
  { capability: object; active: boolean }
>();

/** Seal registration and wait for all registered work before completing its parent. */
export function finishSottoExecutionOperations(capability: SottoJobExecutionCapability) {
  const state = capabilities.get(capability);
  if (!state) throw new Error('The durable execution capability is unavailable');
  if (state.closing) return state.closing;
  state.cancelledAtClose = state.workerSignal.aborted;
  state.live = false;
  state.controller.abort();
  state.closing = (async () => {
    if (state.pending.size) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const drained = await Promise.race([
        Promise.all([...state.pending]).then(() => true),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), 5000);
        }),
      ]);
      if (timer) clearTimeout(timer);
      if (!drained) {
        state.uncertain = true;
        state.markCleanupUnconfirmed();
        throw new Error('Execution operations did not settle during cleanup');
      }
    }
    const failures = [...new Set(state.failures)];
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, 'Execution operations failed');
    if (state.uncertain) throw new Error('Execution cleanup is unconfirmed');
  })();
  return state.closing;
}
const executor = (database: Prisma.TransactionClient) => ({
  query: (sql: string, values: readonly unknown[]) =>
    database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
});
export function sottoJobExecutions(database: Prisma.TransactionClient) {
  return new JobExecutionJournal(executor(database), 'postgres', SIDEDOOR_STATE_ID);
}

/** Check the process-local lifetime and original durable child before dispatch. */
function assertSottoExecutionCapability(
  capability: SottoJobExecutionCapability,
  expected: { parentId: string; fingerprint: string }
) {
  const state = capabilities.get(capability);
  if (
    !state?.live ||
    state.signal.aborted ||
    state.binding.parentId !== expected.parentId ||
    state.binding.fingerprint !== expected.fingerprint
  )
    throw new Error('The durable execution capability is unavailable');
  return { ...state.binding };
}

/** Recheck the exact execution inside the transaction that admits or publishes effects. */
async function verifySottoExecutionCapability(
  database: Prisma.TransactionClient,
  capability: SottoJobExecutionCapability,
  expected: { parentId: string; fingerprint: string }
) {
  const binding = assertSottoExecutionCapability(capability, expected);
  // Lock the journal rows through its own SQL adapter so settlement cannot
  // commit while the caller's admission or publication transaction is open.
  const journal = new JobExecutionJournal(
    {
      query: (sql, values) => {
        if (!sql.startsWith('SELECT ')) throw new Error('Expected a journal read');
        return database.$queryRawUnsafe<Record<string, unknown>[]>(`${sql} FOR UPDATE`, ...values);
      },
    },
    'postgres',
    SIDEDOOR_STATE_ID
  );
  if (
    (await journal.read(binding)).status !== 'active' ||
    (await journal.blockingStatus(expected.parentId, expected.fingerprint)) !== 'active'
  )
    throw new Error('The durable execution is no longer active');
  assertSottoExecutionCapability(capability, expected);
}

/** Register the complete external effect and publication before any work starts. */
export function runSottoExecutionOperation<Result>(
  capability: SottoJobExecutionCapability,
  expected: { parentId: string; fingerprint: string },
  run: (operation: SottoJobExecutionOperation, signal: AbortSignal) => Promise<Result>
): Promise<Result> {
  assertSottoExecutionCapability(capability, expected);
  const state = capabilities.get(capability)!;
  const operation = Object.freeze({});
  const ownership = { capability, active: true };
  operations.set(operation, ownership);
  const result = Promise.resolve().then(() => {
    assertSottoExecutionOperation(operation, expected);
    return run(operation, state.signal);
  });
  const settled = result
    .then(
      () => {},
      (error: unknown) => {
        state.failures.push(error);
      }
    )
    .finally(() => {
      ownership.active = false;
      state.pending.delete(settled);
    });
  state.pending.add(settled);
  return result;
}

/** Only a live registered operation may admit or publish its effects. */
export function assertSottoExecutionOperation(
  operation: SottoJobExecutionOperation,
  expected: { parentId: string; fingerprint: string }
) {
  const ownership = operations.get(operation);
  if (!ownership?.active) throw new Error('The durable execution operation is unavailable');
  return assertSottoExecutionCapability(ownership.capability, expected);
}

/** A stopped capability cannot admit or publish further execution operations. */
export function assertSottoExecutionStopped(capability: SottoJobExecutionCapability) {
  const state = capabilities.get(capability);
  if (!state || (state.live && !state.signal.aborted))
    throw new Error('The durable execution is still accepting operations');
}

/** Do not treat routine completion or a later shutdown as execution uncertainty. */
export function isSottoExecutionUncertain(capability: SottoJobExecutionCapability) {
  const state = capabilities.get(capability);
  if (!state) throw new Error('The durable execution capability is unavailable');
  return state.uncertain || (state.live ? state.workerSignal.aborted : state.cancelledAtClose);
}

/** Check failures recorded by registered operations after admission has stopped. */
export function hasSottoExecutionFailure(capability: SottoJobExecutionCapability) {
  assertSottoExecutionStopped(capability);
  const state = capabilities.get(capability);
  if (!state) throw new Error('The durable execution capability is unavailable');
  return state.failures.length > 0;
}

export async function verifySottoExecutionOperation(
  database: Prisma.TransactionClient,
  operation: SottoJobExecutionOperation,
  expected: { parentId: string; fingerprint: string }
) {
  assertSottoExecutionOperation(operation, expected);
  const ownership = operations.get(operation)!;
  await verifySottoExecutionCapability(database, ownership.capability, expected);
  assertSottoExecutionOperation(operation, expected);
}

/**
 * Own the complete transaction, including commit or rollback, under the execution.
 * `prepare` acquires domain locks before the journal fence when that domain's
 * cleanup path uses the same order. It must perform database work only; any
 * writes roll back if the subsequent execution verification fails.
 */
export function runSottoExecutionTransaction<Result>(
  capability: SottoJobExecutionCapability,
  expected: { parentId: string; fingerprint: string },
  database: PrismaClient,
  run: (transaction: Prisma.TransactionClient) => Promise<Result>,
  options: {
    prepare?: (transaction: Prisma.TransactionClient) => Promise<void>;
    timeoutMs?: number;
  } = {}
) {
  return runSottoExecutionOperation(capability, expected, (operation, signal) =>
    sottoTransaction(
      database,
      async (transaction) => {
        assertSottoExecutionOperation(operation, expected);
        await options.prepare?.(transaction);
        await verifySottoExecutionOperation(transaction, operation, expected);
        const result = await run(transaction);
        await verifySottoExecutionOperation(transaction, operation, expected);
        return result;
      },
      { signal, timeoutMs: options.timeoutMs }
    )
  );
}

async function captureExecutionBinding(
  database: Prisma.TransactionClient,
  input: {
    parentId: string;
    fingerprint: string;
    scope: { subjectId: string; generation: number };
    directory: string;
  }
) {
  const record = await sottoJobOutbox(database).read(input.parentId);
  if (
    !record ||
    record.complete ||
    record.fingerprint !== input.fingerprint ||
    !record.job.scopes.some(
      (scope) =>
        scope.subjectId === input.scope.subjectId && scope.generation === input.scope.generation
    )
  )
    throw new Error('The durable execution scope changed');
  const journal = sottoJobExecutions(database);
  const matches: ExecutionBinding[] = [];
  let cursor: string | null = null;
  let scanned = 0;
  do {
    const page = await journal.listUnresolved(input.scope, cursor);
    for (const execution of page.executions) {
      if (++scanned > 2000) throw new Error('The durable execution inventory is too large');
      if (
        execution.parentId !== input.parentId ||
        execution.fingerprint !== input.fingerprint ||
        execution.executorId !== executorId ||
        execution.status !== 'active' ||
        !execution.workspace ||
        !('directory' in execution.workspace) ||
        execution.workspace.executionId !== execution.id ||
        execution.workspace.directory.root !== input.directory
      )
        continue;
      matches.push({
        id: execution.id,
        parentId: execution.parentId,
        fingerprint: execution.fingerprint,
        executorId: execution.executorId,
      });
    }
    cursor = page.cursor;
  } while (cursor !== null);
  if (
    matches.length !== 1 ||
    (await journal.blockingStatus(input.parentId, input.fingerprint)) !== 'active'
  )
    throw new Error('The exact durable execution could not be identified');
  if ((await journal.read(matches[0]!)).status !== 'active')
    throw new Error('The durable execution is no longer active');
  return matches[0]!;
}

/** Application authority and transactions adapt the shared execution lifecycle. */
export async function withSottoJobExecution<Result>(options: {
  database: PrismaClient;
  parentId: string;
  fingerprint: string;
  signal: AbortSignal;
  validate: (database: Prisma.TransactionClient) => Promise<boolean>;
  isCleanupFailure: (error: unknown) => boolean;
  capabilityScope?: { subjectId: string; generation: number };
  run: (context: {
    markCleanupUnconfirmed: () => void;
    directory: string;
    capability?: SottoJobExecutionCapability;
  }) => Promise<Result>;
}): Promise<Result | undefined> {
  const { database, parentId, fingerprint, signal, validate, isCleanupFailure, run } = options;
  const executionDirectory = resolveSottoExecutionDirectory();
  const location = await openExecutionLocation(executionDirectory, { create: true, signal });
  return runJobExecution({
    namespace: SIDEDOOR_STATE_ID,
    dialect: 'postgres',
    executorId,
    parentId,
    fingerprint,
    signal,
    validate,
    isCleanupFailure,
    executor,
    transaction: (operation, transactionSignal) =>
      sottoTransaction(database, operation, { signal: transactionSignal }),
    workspace: { root: location.root.root, locationId: location.locationId },
    run: async ({ markCleanupUnconfirmed, directory }) => {
      if (!directory) throw new Error('Execution workspace was not created');
      if (!options.capabilityScope) return run({ markCleanupUnconfirmed, directory });
      const binding = await sottoTransaction(
        database,
        (tx) =>
          captureExecutionBinding(tx, {
            parentId,
            fingerprint,
            scope: options.capabilityScope!,
            directory,
          }),
        { signal }
      );
      const capability = Object.freeze({});
      const controller = new AbortController();
      const state: CapabilityState = {
        binding: Object.freeze({ ...binding }),
        live: true,
        signal: AbortSignal.any([signal, controller.signal]),
        workerSignal: signal,
        controller,
        markCleanupUnconfirmed,
        uncertain: false,
        cancelledAtClose: false,
        pending: new Set(),
        failures: [],
      };
      capabilities.set(capability, state);
      let outcome: { value: Result } | { error: unknown };
      try {
        outcome = {
          value: await run({
            markCleanupUnconfirmed: () => {
              state.live = false;
              state.uncertain = true;
              controller.abort();
              markCleanupUnconfirmed();
            },
            directory,
            capability,
          }),
        };
      } catch (error) {
        outcome = { error };
      }
      try {
        await finishSottoExecutionOperations(capability);
      } catch (error) {
        if ('error' in outcome && outcome.error !== error)
          throw new AggregateError([outcome.error, error], 'Execution operations failed');
        throw error;
      }
      if ('error' in outcome) throw outcome.error;
      return outcome.value;
    },
  });
}
