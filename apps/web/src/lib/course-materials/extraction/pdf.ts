import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { ProcessRunner } from 'thesidedoor-core/runtime/process';
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
  const source = await lstat(input.pdfPath);
  if (!source.isFile() || source.isSymbolicLink())
    throw new Error('Material PDF input must be a regular file.');
  const pdfPath = await realpath(input.pdfPath);
  const sourceRelative = relative(executionDirectory, pdfPath);
  if (
    !sourceRelative ||
    sourceRelative === '..' ||
    sourceRelative.startsWith(`..${sep}`) ||
    isAbsolute(sourceRelative)
  )
    throw new Error('Material PDF input must belong to its execution directory.');
  if (source.size < 1 || source.size > limits.maxFileBytes)
    throw new Error('Material PDF input exceeds its byte admission limit.');
  const hash = createHash('sha256');
  let verifiedBytes = 0;
  for await (const chunk of createReadStream(pdfPath, { signal: input.signal })) {
    verifiedBytes += chunk.byteLength;
    if (verifiedBytes > limits.maxFileBytes)
      throw new Error('Material PDF input exceeds its byte admission limit.');
    hash.update(chunk);
  }
  if (verifiedBytes !== source.size)
    throw new Error('Material PDF input changed during admission.');
  if (hash.digest('hex') !== input.expectedSha256)
    throw new Error('Material PDF original checksum changed.');
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
  const metadata = await lstat(resultPath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 2 * 1024 * 1024)
    throw new Error('Material PDF result exceeds its metadata bounds.');
  const result = materialPdfResultSchema.parse(JSON.parse(await readFile(resultPath, 'utf8')));
  if (result.originalSha256 !== input.expectedSha256 || result.originalBytes !== source.size)
    throw new Error('Material PDF result belongs to a different original.');
  return { directory, result };
}
