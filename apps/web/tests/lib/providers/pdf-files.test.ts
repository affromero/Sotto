// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  mkdtemp,
  readFile,
  stat,
  writeFile,
  appendFile,
  truncate,
  symlink,
  rename,
  rm,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProcessRunner, ProcessExecutionError } from 'thesidedoor-core/runtime/process';
import { ProviderCleanupError } from 'thesidedoor-core/ai';
import { StorageReadCleanupError } from 'thesidedoor-core/storage';
import { readBoundedRegularFile } from '@/lib/providers/documents/files';
import { originalPdf } from '../../helpers/learning/pdf';

const boundary = vi.hoisted(() => ({
  afterStat: null as (() => Promise<void>) | null,
  closeFailure: false,
  closeFailurePath: null as string | null,
}));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: async (...parameters: Parameters<typeof actual.open>) => {
      const file = await actual.open(...parameters);
      const stat = file.stat.bind(file);
      const close = file.close.bind(file);
      Object.defineProperty(file, 'stat', {
        value: async () => {
          const result = await stat();
          await boundary.afterStat?.();
          return result;
        },
      });
      Object.defineProperty(file, 'close', {
        value: async () => {
          await close();
          if (boundary.closeFailure || parameters[0] === boundary.closeFailurePath)
            throw new Error('Close acknowledgement lost');
        },
      });
      return file;
    },
  };
});

let directory: string;
let path: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sotto-pdf-files-'));
  path = join(directory, 'original.pdf');
  await writeFile(path, 'complete original', { mode: 0o600 });
});
afterEach(async () => {
  boundary.afterStat = null;
  boundary.closeFailure = false;
  boundary.closeFailurePath = null;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  // The close boundary always closes its real descriptor before simulating lost acknowledgement.
  await rm(directory, { recursive: true, force: true });
});
describe('bounded original PDF file reads', () => {
  it('returns the complete exact-size original', async () => {
    expect(await readBoundedRegularFile(path, { maximum: 17, expectedBytes: 17 })).toEqual(
      Buffer.from('complete original')
    );
  });
  it('retains the opened original when its pathname is replaced after validation', async () => {
    boundary.afterStat = async () => {
      boundary.afterStat = null;
      await rename(path, join(directory, 'retained.pdf'));
      await writeFile(path, 'replacement content');
    };
    expect(await readBoundedRegularFile(path, { maximum: 17 })).toEqual(
      Buffer.from('complete original')
    );
    expect(await readFile(path, 'utf8')).toBe('replacement content');
  });
  it('permits empty text only through explicit empty-file admission', async () => {
    await writeFile(path, '');
    await expect(readBoundedRegularFile(path, { maximum: 17 })).rejects.toThrow('type or size');
    expect(await readBoundedRegularFile(path, { maximum: 17, allowEmpty: true })).toEqual(
      Buffer.alloc(0)
    );
  });
  it('honors cancellation after opening without returning the admitted bytes', async () => {
    const controller = new AbortController();
    const reason = new Error('Learner cancelled the file read');
    boundary.afterStat = async () => controller.abort(reason);
    await expect(
      readBoundedRegularFile(path, { maximum: 17, signal: controller.signal })
    ).rejects.toBe(reason);
    expect(await readFile(path, 'utf8')).toBe('complete original');
  });
  it.each([{ maximum: 16 }, { maximum: 20, expectedBytes: 18 }])(
    'rejects invalid recorded bounds %j',
    async (limits) => {
      await expect(readBoundedRegularFile(path, limits)).rejects.toThrow('type or size');
    }
  );
  it('rejects a symlink in place of the original', async () => {
    const link = join(directory, 'link.pdf');
    await symlink(path, link);
    await expect(readBoundedRegularFile(link, { maximum: 100 })).rejects.toThrow();
  });
  it('rejects a FIFO without waiting for a writer', async () => {
    const fifo = join(directory, 'pipe.pdf');
    await new ProcessRunner(1).execute({
      command: '/usr/bin/mkfifo',
      args: [fifo],
      environment: {},
      timeoutMs: 5000,
    });
    await expect(readBoundedRegularFile(fifo, { maximum: 100 })).rejects.toThrow('type or size');
  });
  it.each(['growth', 'truncation'])(
    'rejects concurrent %s instead of returning partial or oversized content',
    async (change) => {
      boundary.afterStat = async () => {
        if (change === 'growth') await appendFile(path, ' extra');
        else await truncate(path, 3);
      };
      await expect(readBoundedRegularFile(path, { maximum: 17 })).rejects.toThrow(
        change === 'growth' ? 'changed' : 'truncated'
      );
    }
  );
  it('surfaces unconfirmed descriptor closure as a typed storage cleanup failure', async () => {
    boundary.closeFailure = true;
    await expect(readBoundedRegularFile(path, { maximum: 17 })).rejects.toBeInstanceOf(
      StorageReadCleanupError
    );
  });

  it('retains and fences a render when diagnostic file closure is unconfirmed after child exit', async () => {
    const executionRoot = join(directory, 'executions');
    vi.stubEnv('SIDEDOOR_EXECUTION_DIR', executionRoot);
    vi.spyOn(ProcessRunner.prototype, 'execute').mockImplementation(async (request) => {
      const workspace = request.args.at(-1)!;
      boundary.closeFailurePath = join(workspace, 'failure.json');
      await writeFile(boundary.closeFailurePath, JSON.stringify({ message: 'Invalid source PDF' }));
      throw new ProcessExecutionError('exit_failed', 1);
    });
    const { renderPdfImages } = await import('@/lib/providers/documents/process');
    await expect(renderPdfImages(originalPdf())).rejects.toBeInstanceOf(ProviderCleanupError);
    const state = JSON.parse(
      await readFile(join(executionRoot, 'pdf-render/renderer.json'), 'utf8')
    ) as {
      active: { phase: string; workspace: string };
    };
    expect(state.active.phase).toBe('cleanup-unconfirmed');
    const workspace = JSON.parse(state.active.workspace) as { directory: { root: string } };
    expect((await stat(join(workspace.directory.root, 'original.pdf'))).isFile()).toBe(true);
    await expect(renderPdfImages(originalPdf())).rejects.toBeInstanceOf(ProviderCleanupError);
  });
});
