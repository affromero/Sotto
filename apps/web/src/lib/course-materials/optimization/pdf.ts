import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { access, link, lstat, mkdtemp, realpath, stat } from 'node:fs/promises';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { ProcessExecutionError, ProcessRunner } from 'thesidedoor-core/runtime/process';
import { extractMaterialPdf } from '../extraction/pdf';
import {
  materialPdfDefaultLimits,
  materialPdfLimitsSchema,
  type MaterialPdfLimits,
} from '../extraction/pdf-protocol';
import { compareMaterialPdfSemantics, type PdfSemanticVerification } from './verification';

export interface PdfOptimizationOptions {
  originalPath: string;
  outputPath: string;
  signal: AbortSignal;
  executable?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  parserLimits?: Partial<MaterialPdfLimits>;
}

export type PdfOptimizationResult =
  | {
      status: 'optimized';
      diagnostic: string;
      originalPath: string;
      outputPath: string;
      originalBytes: number;
      optimizedBytes: number;
      savedBytes: number;
      pageCount: number;
      verification: Extract<PdfSemanticVerification, { verified: true }>['proof'];
    }
  | {
      status: 'unavailable' | 'failed' | 'unchanged';
      diagnostic: string;
      originalPath: string;
    };

function hasCode(error: unknown, code: string): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if ('code' in current && current.code === code) return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}

function cleanupUnconfirmed(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if (
      current instanceof AggregateError ||
      (current instanceof ProcessExecutionError && current.code === 'cleanup_failed')
    )
      return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}

function pageCount(stdout: string): number {
  const value = stdout.trim();
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new Error('qpdf returned an invalid page count.');
  return Number(value);
}

async function hashFile(path: string, signal: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path, { signal })) hash.update(bytes);
  return hash.digest('hex');
}

/** Resolve the configured command once. The child receives no inherited environment. */
async function resolveExecutable(command: string): Promise<string | null> {
  const candidates =
    isAbsolute(command) || command.includes('/')
      ? [resolve(command)]
      : (process.env.PATH ?? '')
          .split(delimiter)
          .filter(Boolean)
          .map((directory) => join(directory, command));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      const path = await realpath(candidate);
      if ((await stat(path)).isFile()) return path;
    } catch (error) {
      if (!hasCode(error, 'ENOENT') && !hasCode(error, 'EACCES') && !hasCode(error, 'ENOTDIR'))
        throw error;
    }
  }
  return null;
}

/**
 * Creates an optional derivative in a caller-owned private workspace.
 * The caller owns staging-directory cleanup after confirmed process settlement.
 * A smaller candidate is admitted only after complete supported page semantics match.
 */
export async function optimizeMaterialPdf(
  options: PdfOptimizationOptions
): Promise<PdfOptimizationResult> {
  const { signal } = options;
  signal.throwIfAborted();
  const originalPath = resolve(options.originalPath);
  const failure = (
    status: 'unavailable' | 'failed' | 'unchanged',
    diagnostic: string
  ): PdfOptimizationResult => {
    signal.throwIfAborted();
    return { status, diagnostic, originalPath };
  };
  const timeoutMs = options.timeoutMs ?? 30000;
  const maxOutputBytes = options.maxOutputBytes ?? 65536;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 300000 ||
    !Number.isSafeInteger(maxOutputBytes) ||
    maxOutputBytes < 1 ||
    maxOutputBytes > 1048576 ||
    !options.originalPath.trim() ||
    !options.outputPath.trim() ||
    !(options.executable ?? 'qpdf').trim()
  )
    return failure('failed', 'Invalid PDF optimization options.');

  let stage = 'path validation';
  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(new Error('PDF optimization exceeded its deadline.')),
    timeoutMs
  );
  const combined = AbortSignal.any([signal, deadline.signal]);
  const runner = new ProcessRunner(1);
  let executable: string | null = null;
  let temporaryDirectory = '';
  const execute = (args: string[]) =>
    runner.execute({
      command: executable!,
      args,
      environment: {
        PATH: dirname(executable!),
        LANG: 'C',
        LC_ALL: 'C',
        TZ: 'UTC',
        TMPDIR: temporaryDirectory,
        TMP: temporaryDirectory,
        TEMP: temporaryDirectory,
      },
      signal: combined,
      timeoutMs,
      maxOutputBytes,
      maxOutputBytesPerChannel: maxOutputBytes,
    });

  try {
    const parserLimits = materialPdfLimitsSchema.parse({
      ...materialPdfDefaultLimits,
      ...options.parserLimits,
    });
    executable = await resolveExecutable(options.executable ?? 'qpdf');
    if (!executable)
      return failure('unavailable', 'The configured qpdf executable is unavailable.');
    const input = await realpath(originalPath);
    const outputPath = join(
      await realpath(dirname(resolve(options.outputPath))),
      basename(resolve(options.outputPath))
    );
    if (input === outputPath) return failure('failed', 'The output must differ from the original.');
    try {
      await lstat(outputPath);
      return failure('failed', 'The output path already exists.');
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) throw error;
    }
    const original = await stat(input, { bigint: true });
    if (
      !original.isFile() ||
      original.size < 1n ||
      original.size > BigInt(parserLimits.maxFileBytes)
    )
      return failure('failed', 'The original must be a nonempty regular PDF file.');
    temporaryDirectory = await mkdtemp(join(dirname(outputPath), '.pdf-optimization-'));
    combined.throwIfAborted();
    stage = 'input validation';
    await execute(['--check', input]);
    stage = 'input page counting';
    const pages = pageCount((await execute(['--show-npages', input])).stdout);
    combined.throwIfAborted();

    // The private candidate is linked exclusively after validation, so no output is overwritten.
    try {
      await lstat(outputPath);
      return failure('failed', 'The output path already exists.');
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) throw error;
    }
    const candidatePath = join(temporaryDirectory, 'candidate.pdf');
    combined.throwIfAborted();
    stage = 'compression';
    await execute([
      '--object-streams=generate',
      '--stream-data=compress',
      '--recompress-flate',
      '--compression-level=9',
      input,
      candidatePath,
    ]);
    stage = 'output validation';
    const candidate = await lstat(candidatePath);
    if (!candidate.isFile() || candidate.size < 1)
      return failure('failed', 'qpdf did not create a regular nonempty PDF.');
    await execute(['--check', candidatePath]);
    stage = 'output page counting';
    const outputPages = pageCount((await execute(['--show-npages', candidatePath])).stdout);
    if (outputPages !== pages)
      return failure('failed', 'The optimized PDF page count differs from the original.');
    const current = await stat(input, { bigint: true });
    if (
      current.dev !== original.dev ||
      current.ino !== original.ino ||
      current.size !== original.size ||
      current.mtimeNs !== original.mtimeNs ||
      current.ctimeNs !== original.ctimeNs
    )
      return failure('failed', 'The original changed during optimization.');
    combined.throwIfAborted();
    const originalBytes = Number(original.size);
    if (candidate.size >= originalBytes)
      return failure(
        'unchanged',
        'qpdf produced no smaller candidate. The original remains retained.'
      );
    stage = 'complete semantic verification';
    const originalSha256 = await hashFile(input, combined);
    const candidateSha256 = await hashFile(candidatePath, combined);
    const originalParsed = await extractMaterialPdf({
      pdfPath: input,
      executionDirectory: dirname(input),
      expectedSha256: originalSha256,
      limits: parserLimits,
      signal: combined,
    });
    const candidateParsed = await extractMaterialPdf({
      pdfPath: candidatePath,
      executionDirectory: temporaryDirectory,
      expectedSha256: candidateSha256,
      limits: parserLimits,
      signal: combined,
    });
    const verification = await compareMaterialPdfSemantics(
      originalParsed,
      candidateParsed,
      combined
    );
    if (!verification.verified) return failure('failed', verification.diagnostic);
    if (
      (await hashFile(input, combined)) !== originalSha256 ||
      (await hashFile(candidatePath, combined)) !== candidateSha256
    )
      return failure('failed', 'PDF bytes changed during semantic verification.');
    stage = 'candidate publication';
    combined.throwIfAborted();
    await link(candidatePath, outputPath);
    combined.throwIfAborted();
    return {
      status: 'optimized',
      diagnostic:
        'Created a smaller PDF with verified page text, pixels, geometry and annotations.',
      originalPath,
      outputPath,
      originalBytes,
      optimizedBytes: candidate.size,
      savedBytes: originalBytes - candidate.size,
      pageCount: pages,
      verification: verification.proof,
    };
  } catch (error) {
    if (cleanupUnconfirmed(error)) throw error;
    signal.throwIfAborted();
    if (deadline.signal.aborted)
      return failure('failed', 'PDF optimization exceeded its deadline.');
    if (
      error instanceof ProcessExecutionError &&
      error.code === 'start_failed' &&
      hasCode(error, 'ENOENT')
    )
      return failure('unavailable', 'The configured qpdf executable is unavailable.');
    const detail =
      error instanceof ProcessExecutionError
        ? error.code + (error.exitCode === null ? '' : ', exit ' + error.exitCode)
        : 'invalid input or filesystem result';
    return failure('failed', 'PDF optimization failed during ' + stage + ' (' + detail + ').');
  } finally {
    clearTimeout(timer);
  }
}
