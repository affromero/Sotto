import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { ProviderCleanupError } from 'thesidedoor-core/ai';
import { isJobExecutionCleanupFailure } from 'thesidedoor-core/runtime/outbox';
import {
  FileStateStore,
  openExecutionLocation,
  planExecutionWorkspace,
  createExecutionWorkspace,
  recoverExecutionWorkspace,
  removeExecutionWorkspace,
  type ExecutionWorkspace,
} from 'thesidedoor-core/storage';
import { logger } from '@/lib/logger';
import { resolveSottoExecutionDirectory } from '@/lib/sidedoor/jobs/core/execution-directory';

const owner = {
  executorId: randomUUID(),
  hostname: hostname(),
  pid: process.pid,
  startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
};
const stateSchema = z
  .object({
    active: z
      .object({
        executionId: z.uuid(),
        owner: z
          .object({
            executorId: z.uuid(),
            hostname: z.string(),
            pid: z.number().int().positive(),
            startedAt: z.iso.datetime(),
          })
          .strict(),
        plan: z.string().max(65536),
        workspace: z.string().max(65536).nullable(),
        phase: z.enum(['planned', 'launching', 'cleanup-unconfirmed']),
      })
      .strict()
      .nullable(),
  })
  .strict();
class PdfBusyError extends Error {}
let poisoned: ProviderCleanupError | undefined;

/** A durable receipt fences retries after crashes or uncertain child/file cleanup. */
export async function withPdfWorkspace<T>(
  run: (directory: string) => Promise<T>,
  options: { signal?: AbortSignal; onCleanupError?: (error: unknown) => void }
): Promise<T> {
  if (poisoned) throw poisoned;
  options.signal?.throwIfAborted();
  const root = await openExecutionLocation(resolveSottoExecutionDirectory(), {
    create: true,
    signal: options.signal,
  });
  const location = await openExecutionLocation(join(root.root.root, 'pdf-render'), {
    create: true,
    signal: options.signal,
  });
  const receipt = join(location.root.root, 'renderer.json');
  const store = new FileStateStore<z.infer<typeof stateSchema>>({
    path: receipt,
    initial: () => ({ active: null }),
    parse: (value) => stateSchema.parse(value),
  });
  const executionId = randomUUID();
  const plan = await planExecutionWorkspace(location.root.root, location.locationId, executionId);
  let workspace: ExecutionWorkspace | undefined;
  let admitted = false;
  let uncertain = false;
  let primary: unknown;
  const unconfirmed = async (cause: unknown): Promise<never> => {
    uncertain = true;
    try {
      await store.transact((state) => {
        if (state.active?.executionId !== executionId)
          throw new Error('PDF ownership is unconfirmed.');
        state.active.phase = 'cleanup-unconfirmed';
      });
    } catch (error) {
      cause = new AggregateError([cause, error], 'PDF ownership could not be settled.');
    }
    poisoned = new ProviderCleanupError(true, { cause });
    logger.error('PDF renderer cleanup needs operator recovery', { receipt, executionId });
    options.onCleanupError?.(poisoned);
    throw poisoned;
  };
  try {
    try {
      await store.transact((state) => {
        if (state.active)
          throw new PdfBusyError(
            'PDF rendering is already owned. Retry after it finishes. Interrupted renders require operator recovery.'
          );
        state.active = {
          executionId,
          owner,
          plan: JSON.stringify(plan),
          workspace: null,
          phase: 'planned',
        };
      });
      admitted = true;
    } catch (error) {
      if (error instanceof PdfBusyError) throw error;
      return unconfirmed(error);
    }
    workspace = await createExecutionWorkspace(plan);
    try {
      await store.transact((state) => {
        if (state.active?.executionId !== executionId) throw new Error('PDF ownership changed.');
        state.active.workspace = JSON.stringify(workspace);
        state.active.phase = 'launching';
      });
    } catch (error) {
      return unconfirmed(error);
    }
    return await run(workspace.directory.root);
  } catch (error) {
    primary = error;
    if (isJobExecutionCleanupFailure(error)) return unconfirmed(error);
    throw error;
  } finally {
    if (admitted && !uncertain) {
      try {
        // No child can have started when workspace creation did not return.
        workspace ??= (await recoverExecutionWorkspace(plan, location.locationId)) ?? undefined;
        if (workspace) await removeExecutionWorkspace(workspace, location.locationId);
        await store.transact((state) => {
          if (state.active?.executionId !== executionId) throw new Error('PDF ownership changed.');
          state.active = null;
        });
      } catch (error) {
        await unconfirmed(
          primary
            ? new AggregateError([primary, error], 'PDF processing and cleanup failed')
            : error
        );
      }
    }
  }
}
