// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ExecutionWorkspace } from 'thesidedoor-core/storage';
import { originalPdf } from '../../helpers/learning/pdf';

let directory: string;
beforeEach(async () => {
  vi.resetModules();
  directory = await mkdtemp(join(tmpdir(), 'sotto-pdf-lifetime-'));
  vi.stubEnv('SIDEDOOR_EXECUTION_DIR', join(directory, 'executions'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  // Both mocked system boundaries below launch no process or background I/O.
  await rm(directory, { recursive: true, force: true });
});

describe('owned PDF render lifetime', () => {
  it('removes originals after confirmed failure and excludes provider secrets from the child', async () => {
    const { ProcessRunner, ProcessExecutionError } =
      await import('thesidedoor-core/runtime/process');
    let workspace: string | undefined;
    const original = originalPdf();
    vi.stubEnv('OPENAI_API_KEY', 'private-test-key');
    vi.spyOn(ProcessRunner.prototype, 'execute').mockImplementation(async (request) => {
      workspace = request.args.at(-1)!;
      const file = await open(join(workspace, 'original.pdf'), 'r');
      try {
        expect((await file.stat()).mode & 0o777).toBe(0o600);
        expect(await file.readFile()).toEqual(original);
      } finally {
        await file.close();
      }
      expect(request.environment).not.toHaveProperty('OPENAI_API_KEY');
      expect(request.environment).not.toHaveProperty('NODE_OPTIONS');
      expect(request.keepInputOpen).toBe(true);
      throw new ProcessExecutionError('exit_failed', 1);
    });
    const { renderPdfImages } = await import('@/lib/providers/documents/process');
    await expect(renderPdfImages(original)).rejects.toThrow('could not be rendered');
    expect(workspace).toBeDefined();
    await expect(stat(workspace!)).rejects.toMatchObject({ code: 'ENOENT' });
    const state: unknown = JSON.parse(
      await readFile(join(directory, 'executions/pdf-render/renderer.json'), 'utf8')
    );
    expect(state).toEqual({ active: null });
  });

  it.each(['direct', 'aggregate', 'cause', 'storage', 'storage-aggregate'])(
    'retains originals and fences work after %s cleanup uncertainty',
    async (shape) => {
      const { ProcessRunner, ProcessExecutionError } =
        await import('thesidedoor-core/runtime/process');
      const { ProviderCleanupError } = await import('thesidedoor-core/ai');
      const { StorageReadCleanupError } = await import('thesidedoor-core/storage');
      const failure = shape.startsWith('storage')
        ? new StorageReadCleanupError({ cause: new Error('File closure unconfirmed') })
        : new ProcessExecutionError('cleanup_failed');
      const error = shape.endsWith('aggregate')
        ? new AggregateError([failure], 'Interrupted process')
        : shape === 'cause'
          ? new Error('Interrupted process', { cause: failure })
          : failure;
      vi.spyOn(ProcessRunner.prototype, 'execute').mockRejectedValue(error);
      const { renderPdfImages } = await import('@/lib/providers/documents/process');
      let observed: unknown;
      await expect(
        renderPdfImages(originalPdf(), {
          onCleanupError: (error) => {
            observed = error;
          },
        })
      ).rejects.toBeInstanceOf(ProviderCleanupError);
      expect(observed).toBeInstanceOf(ProviderCleanupError);
      const state = JSON.parse(
        await readFile(join(directory, 'executions/pdf-render/renderer.json'), 'utf8')
      ) as {
        active: { phase: string; workspace: string };
      };
      expect(state.active.phase).toBe('cleanup-unconfirmed');
      const workspace = JSON.parse(state.active.workspace) as ExecutionWorkspace;
      expect((await stat(join(workspace.directory.root, 'original.pdf'))).isFile()).toBe(true);
      await expect(renderPdfImages(originalPdf())).rejects.toBeInstanceOf(ProviderCleanupError);
    }
  );

  it('rejects pre-cancelled input before creating a workspace or launching a child', async () => {
    const { ProcessRunner } = await import('thesidedoor-core/runtime/process');
    vi.spyOn(ProcessRunner.prototype, 'execute').mockRejectedValue(new Error('Unexpected child'));
    const controller = new AbortController();
    const reason = new Error('PDF request cancelled');
    controller.abort(reason);
    const { renderPdfImages } = await import('@/lib/providers/documents/process');
    await expect(renderPdfImages(originalPdf(), { signal: controller.signal })).rejects.toBe(
      reason
    );
    await expect(stat(join(directory, 'executions'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('stops rendering on parent stdin loss and confirms exit before workspace removal', async () => {
    const { ProcessRunner } = await import('thesidedoor-core/runtime/process');
    await writeFile(join(directory, 'original.pdf'), originalPdf(20), { mode: 0o600 });
    await expect(
      new ProcessRunner(1).execute({
        command: process.execPath,
        args: [
          '--max-old-space-size=64',
          join(process.cwd(), 'scripts/pdf-render/render-worker.mjs'),
          directory,
        ],
        environment: { PATH: '/usr/local/bin:/usr/bin:/bin' },
        cwd: process.cwd(),
        keepInputOpen: false,
        timeoutMs: 10000,
        maxOutputBytes: 1024 * 1024,
      })
    ).rejects.toMatchObject({ code: 'exit_failed' });
    await expect(stat(join(directory, 'pages.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(await readFile(join(directory, 'renderer.json'), 'utf8'))).toHaveProperty(
      'pid'
    );
  });
});
