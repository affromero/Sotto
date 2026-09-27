import { lstat } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import type { JobExecutionBinding } from 'thesidedoor-core/runtime/outbox';
import {
  LocalStorageCleanup,
  openExecutionLocation,
  recoverExecutionWorkspace,
  removeExecutionWorkspace,
} from 'thesidedoor-core/storage';
import { prismaUnfiltered } from '../../prisma';
import { sottoTransaction } from '../../sidedoor/access/state/transaction';
import {
  sottoJobExecutions,
  resolveSottoExecutionDirectory,
} from '../../sidedoor/jobs/core/job-execution-lifetime';
import { sottoJobOutbox } from '../../sidedoor/jobs/core/job-delivery';
import {
  CLASS_PREPARATION_QUEUE,
  classPreparationPayload,
  classPreparationStore,
} from '../../classes/preparation';
import { classPreparationGrant } from '../../classes/preparation-grant';
import { reconcileIsolatedAgentWorkspace } from './isolated-agent-journal';

/** Operator-only recovery. The caller must stop the exact supervisor and its I/O first. */
export async function recoverIsolatedPreparationExecution(input: {
  binding: JobExecutionBinding;
  supervisorStopped: true;
}): Promise<{ containers: number; executionId: string }> {
  if (input.supervisorStopped !== true)
    throw new Error('Stop the original supervisor before recovery');
  const binding = structuredClone(input.binding);
  const record = await sottoTransaction(prismaUnfiltered, async (database) => {
    const journal = sottoJobExecutions(database);
    const execution = await journal.read(binding);
    const parent = await sottoJobOutbox(database).read(binding.parentId);
    if (
      !parent ||
      parent.fingerprint !== binding.fingerprint ||
      parent.job.handler !== CLASS_PREPARATION_QUEUE
    )
      throw new Error('Recovery requires the exact class-preparation execution');
    const payload = classPreparationPayload.parse(parent.job.payload);
    if (payload.operationId !== binding.parentId)
      throw new Error('Preparation parent identity changed');
    const store = classPreparationStore(database, payload.courseId);
    const operation = await store.read();
    if (!operation || operation.id !== binding.parentId || !operation.selection.isolatedImage)
      throw new Error('The isolated preparation binding changed');
    if (!['RUNNING', 'UNRESOLVED', 'CANCELLING', 'CANCELLED'].includes(operation.status))
      throw new Error('This preparation does not require supervisor recovery');
    await classPreparationGrant(database, operation).revoke(operation.grant);
    await store.transact((current) => {
      if (!current || current.id !== operation.id) throw new Error('Preparation identity changed');
      if (current.status !== 'CANCELLED') {
        current.status = 'UNRESOLVED';
        current.failure = 'interrupted';
        current.updatedAt = Date.now();
      }
    });
    return execution;
  });
  if (record.status === 'settled') return { containers: 0, executionId: record.id };
  const location = await openExecutionLocation(resolveSottoExecutionDirectory());
  let containers = 0;
  if (record.workspace) {
    if (record.workspace.locationId !== location.locationId)
      throw new Error('Execution belongs to another workspace location');
    const workspace =
      'directory' in record.workspace
        ? record.workspace
        : await recoverExecutionWorkspace(record.workspace, location.locationId);
    if (workspace) {
      await lstat(workspace.directory.root);
      await LocalStorageCleanup.restore(workspace.directory);
      containers = await reconcileIsolatedAgentWorkspace(workspace.directory.root);
      await removeExecutionWorkspace(workspace, location.locationId);
    }
    await sottoTransaction(prismaUnfiltered, async (database) => {
      const journal = sottoJobExecutions(database);
      const current = await journal.read(binding);
      if (current.workspace) {
        if (!isDeepStrictEqual(current.workspace, record.workspace))
          throw new Error('Execution workspace identity changed during recovery');
        await journal.releaseWorkspace(binding, current.workspace);
      }
    });
  }
  await sottoTransaction(prismaUnfiltered, (database) =>
    sottoJobExecutions(database).settle(binding)
  );
  return { containers, executionId: binding.id };
}
