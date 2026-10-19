import { describe, expect, it } from 'vitest';
import { AccessError } from 'thesidedoor-core/access';
import { GenerationUsageError, IncompleteGenerationError } from 'thesidedoor-core/ai/usage';
import { DelegationDeniedError } from 'thesidedoor-core/runtime/delegation';
import { ProcessExecutionError } from 'thesidedoor-core/runtime/process';
import { Prisma } from '@/generated/prisma/client';
import { generationDiagnostic } from '@/lib/classes/quality/failure/diagnostic';

describe('safe terminal generation diagnostics', () => {
  it.each([
    ['start_failed', null],
    ['exit_failed', 1],
    ['output_limit', null],
    ['busy', null],
    ['cleanup_failed', null],
  ] as const)('retains the trusted process code %s without process output', (code, exitCode) => {
    const error = new ProcessExecutionError(code, exitCode);
    error.diagnostics = { stdout: 'Private generated material.', stderr: 'Private credential.' };
    error.remoteFailureCodes = ['Private supervisor data.'];
    error.message = 'Private process message.';
    expect(generationDiagnostic(error)).toEqual({
      type: 'process',
      code,
      ...(exitCode === null ? {} : { exitCode }),
    });
  });

  it.each([0, 255])('retains the bounded process exit status %s', (exitCode) => {
    expect(generationDiagnostic(new ProcessExecutionError('exit_failed', exitCode))).toEqual({
      type: 'process',
      code: 'exit_failed',
      exitCode,
    });
  });

  it.each([-1, 256, NaN, Infinity, 1.5])('omits an invalid process exit status %s', (exitCode) => {
    expect(generationDiagnostic(new ProcessExecutionError('exit_failed', exitCode))).toEqual({
      type: 'process',
      code: 'exit_failed',
    });
  });

  it('distinguishes trusted delegation, access and incomplete generation failures', () => {
    expect(generationDiagnostic(new DelegationDeniedError('closed'))).toEqual({
      type: 'delegation',
      code: 'closed',
    });
    expect(
      generationDiagnostic(new AccessError('forbidden', 'Private authorization detail.'))
    ).toEqual({
      type: 'access',
      code: 'forbidden',
    });
    for (const reason of ['length', 'tool_calls'] as const)
      expect(generationDiagnostic(new IncompleteGenerationError(reason))).toEqual({
        type: 'incomplete_generation',
        code: reason,
      });
  });

  it('allows only known database codes and fixed transaction conflict reasons', () => {
    for (const [code, meta, expected] of [
      ['P2034', {}, 'P2034'],
      ['P2002', { target: 'Private database field.' }, 'P2002'],
      ['P2010', { code: '40001', message: 'Private SQL.' }, 'serialization_conflict'],
      ['P2010', { code: '40P01', message: 'Private SQL.' }, 'deadlock'],
      ['P2010', { code: 'Private SQL state.' }, 'P2010'],
    ] as const) {
      const error = new Prisma.PrismaClientKnownRequestError('Private database diagnostic.', {
        code,
        meta,
        clientVersion: 'fixture',
      });
      expect(generationDiagnostic(error)).toEqual({ type: 'prisma', code: expected });
    }
    expect(
      generationDiagnostic(
        new Prisma.PrismaClientKnownRequestError('Private database diagnostic.', {
          code: 'Private arbitrary code.',
          clientVersion: 'fixture',
        })
      )
    ).toEqual({ type: 'unknown', code: 'unknown' });
  });

  it('keeps usage wrappers generic while recovering trusted causes through four links', () => {
    const process = new ProcessExecutionError('exit_failed', 2);
    process.diagnostics = { stdout: 'Private answer.', stderr: 'Private credential.' };
    let error: Error = process;
    for (let depth = 0; depth < 4; depth++)
      error = new GenerationUsageError(
        'Private provider body.',
        { inputTokens: 12, outputTokens: 4 },
        { cause: error }
      );
    Object.assign(error, { code: 'Private provider code.', status: 429 });
    error.name = 'Private provider name.';
    expect(generationDiagnostic(error)).toEqual({
      type: 'process',
      code: 'exit_failed',
      exitCode: 2,
    });
    expect(generationDiagnostic(new Error('Private outer error.', { cause: error }))).toEqual({
      type: 'generation_usage',
      code: 'failed',
    });
    expect(
      generationDiagnostic(
        new GenerationUsageError('Private body.', { inputTokens: null, outputTokens: null })
      )
    ).toEqual({
      type: 'generation_usage',
      code: 'failed',
    });
  });

  it('stops at cyclic causes without discarding the trusted terminal code', () => {
    const process = new ProcessExecutionError('busy');
    const wrapper = new Error('Private wrapper.', { cause: process });
    Object.defineProperty(process, 'cause', { value: wrapper });
    expect(generationDiagnostic(wrapper)).toEqual({ type: 'process', code: 'busy' });
    expect(wrapper.cause).toBe(process);
    expect(process.cause).toBe(wrapper);
  });

  it('preserves a trusted process failure when its cause only carries generic usage', () => {
    const cause = new GenerationUsageError('Private provider body.', {
      inputTokens: 12,
      outputTokens: 4,
    });
    const error = new ProcessExecutionError('cleanup_failed', null, { cause });
    expect(generationDiagnostic(error)).toEqual({ type: 'process', code: 'cleanup_failed' });
  });

  it('rejects lookalike objects, arbitrary codes and mutated trusted code fields', () => {
    const process = new ProcessExecutionError('exit_failed', 1);
    Object.defineProperty(process, 'code', { value: 'Private forged code.' });
    for (const error of [
      'Private error text.',
      { code: 'exit_failed', exitCode: 1, cause: new ProcessExecutionError('busy') },
      Object.assign(new Error('Private error text.'), {
        code: 'P2034',
        name: 'ProcessExecutionError',
      }),
      process,
    ])
      expect(generationDiagnostic(error)).toEqual({ type: 'unknown', code: 'unknown' });
  });

  it('does not invoke arbitrary cause accessors while inspecting an error', () => {
    const error = new Error('Private failure.');
    Object.defineProperty(error, 'cause', {
      get() {
        throw new Error('Private accessor content.');
      },
    });
    expect(generationDiagnostic(error)).toEqual({ type: 'unknown', code: 'unknown' });
  });
});
