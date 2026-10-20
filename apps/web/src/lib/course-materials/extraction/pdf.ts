import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { ProcessRunner } from 'thesidedoor-core/runtime/process';
import { readBoundedRegularFile, withBoundedRegularFile } from '../../providers/documents/files';
import {
  materialPdfDefaultLimits,
  materialPdfLimitsSchema,
  materialPdfRequestSchema,
  materialPdfResultSchema,
  type MaterialPdfLimits,
} from './pdf-protocol';

const runner = new ProcessRunner(1);

/** npm workspace commands run in apps/web; direct root commands keep the repository cwd. */
async function webRuntimeDirectory(): Promise<string> {
  const current = await realpath(process.cwd());
  for (const directory of [current, join(current, 'apps/web')]) {
    try {
      const metadata: unknown = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (
        metadata &&
        typeof metadata === 'object' &&
        'name' in metadata &&
        metadata.name === '@sotto/web'
      )
        return directory;
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
        throw error;
    }
  }
  throw new Error('Material PDF runtime requires the Sotto root or web workspace directory.');
}

/** Process isolation bounds V8, time and output. Native PDF/canvas RSS needs an OS/container limit. */
export async function extractMaterialPdf(input: {
  pdfPath: string;
  executionDirectory: string;
  expectedSha256: string;
  limits?: Partial<MaterialPdfLimits>;
  signal?: AbortSignal;
}) {
  input.signal?.throwIfAborted();
  const limits = materialPdfLimitsSchema.parse({ ...materialPdfDefaultLimits, ...input.limits });
  const executionDirectory = await realpath(input.executionDirectory);
  if (!isAbsolute(input.pdfPath)) throw new Error('Material PDF input must be an absolute path.');
  const pdfPath = await realpath(input.pdfPath);
  const sourceRelative = relative(executionDirectory, pdfPath);
  if (
    !sourceRelative ||
    sourceRelative === '..' ||
    sourceRelative.startsWith(`..${sep}`) ||
    isAbsolute(sourceRelative)
  )
    throw new Error('Material PDF input must belong to its execution directory.');
  const sourceSize = await withBoundedRegularFile(
    input.pdfPath,
    { maximum: limits.maxFileBytes, signal: input.signal },
    async (file, size) => {
      const hash = createHash('sha256');
      const buffer = Buffer.alloc(Math.min(size, 65536));
      let verifiedBytes = 0;
      while (verifiedBytes < size) {
        input.signal?.throwIfAborted();
        const { bytesRead } = await file.read(
          buffer,
          0,
          Math.min(buffer.length, size - verifiedBytes)
        );
        if (!bytesRead) throw new Error('Material PDF input was truncated during admission.');
        verifiedBytes += bytesRead;
        hash.update(buffer.subarray(0, bytesRead));
      }
      if ((await file.read(Buffer.alloc(1))).bytesRead)
        throw new Error('Material PDF input changed during admission.');
      if (hash.digest('hex') !== input.expectedSha256)
        throw new Error('Material PDF original checksum changed.');
      return size;
    }
  );
  const directory = join(executionDirectory, `pdf-${randomUUID()}`);
  await mkdir(directory, { mode: 0o700 });
  const requestPath = join(directory, 'request.json');
  const request = materialPdfRequestSchema.parse({
    schemaVersion: 1,
    pdfPath,
    directory,
    expectedSha256: input.expectedSha256,
    limits,
  });
  await writeFile(requestPath, JSON.stringify(request), { flag: 'wx', mode: 0o600 });
  const webDirectory = await webRuntimeDirectory();
  const requireRuntime = createRequire(join(webDirectory, 'package.json'));
  const childModule = join(
    webDirectory,
    'src/lib/course-materials/extraction/runtime/pdf-child.ts'
  );
  await runner.execute({
    command: process.execPath,
    args: [
      `--max-old-space-size=${limits.heapMiB}`,
      '--import',
      requireRuntime.resolve('tsx'),
      childModule,
      requestPath,
    ],
    cwd: webDirectory,
    environment: {
      PATH: dirname(process.execPath),
      LANG: 'C.UTF-8',
      TZ: 'UTC',
      TMPDIR: directory,
      TMP: directory,
      TEMP: directory,
    },
    signal: input.signal,
    timeoutMs: limits.timeoutMs,
    maxOutputBytes: limits.maxProcessOutputBytes,
    maxOutputBytesPerChannel: limits.maxProcessOutputBytes,
  });
  const resultPath = join(directory, 'result.json');
  const result = materialPdfResultSchema.parse(
    JSON.parse(
      (
        await readBoundedRegularFile(resultPath, {
          maximum: 2 * 1024 * 1024,
          signal: input.signal,
        })
      ).toString('utf8')
    )
  );
  if (result.originalSha256 !== input.expectedSha256 || result.originalBytes !== sourceSize)
    throw new Error('Material PDF result belongs to a different original.');
  return { directory, result };
}
