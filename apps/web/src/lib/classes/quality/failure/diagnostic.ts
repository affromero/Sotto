import { AccessError } from 'thesidedoor-core/access';
import { GenerationUsageError, IncompleteGenerationError } from 'thesidedoor-core/ai/usage';
import { DelegationDeniedError } from 'thesidedoor-core/runtime/delegation';
import { ProcessExecutionError } from 'thesidedoor-core/runtime/process';
import { Prisma } from '@/generated/prisma/client';

const processCodes = [
  'start_failed',
  'exit_failed',
  'output_limit',
  'busy',
  'cleanup_failed',
] as const;
const delegationCodes = [
  'missing',
  'binding',
  'closed',
  'expired',
  'budget',
  'attempt',
  'unsettled',
] as const;
const accessCodes = ['unauthorized', 'forbidden', 'invalid', 'rate_limited', 'conflict'] as const;
const prismaCodes = [
  'P1001',
  'P1002',
  'P2002',
  'P2003',
  'P2010',
  'P2024',
  'P2025',
  'P2034',
] as const;

type GenerationDiagnostic =
  | { type: 'process'; code: (typeof processCodes)[number]; exitCode?: number }
  | { type: 'delegation'; code: (typeof delegationCodes)[number] }
  | { type: 'access'; code: (typeof accessCodes)[number] }
  | { type: 'prisma'; code: (typeof prismaCodes)[number] | 'serialization_conflict' | 'deadlock' }
  | { type: 'generation_usage'; code: 'failed' }
  | { type: 'incomplete_generation'; code: 'length' | 'tool_calls' }
  | { type: 'unknown'; code: 'unknown' };

function trustedDiagnostic(error: Error): GenerationDiagnostic | undefined {
  if (error instanceof ProcessExecutionError) {
    const { code, exitCode } = error;
    if (processCodes.includes(code))
      return {
        type: 'process',
        code,
        ...(Number.isInteger(exitCode) && exitCode !== null && exitCode >= 0 && exitCode <= 255
          ? { exitCode }
          : {}),
      };
  }
  if (error instanceof DelegationDeniedError) {
    const code = error.code;
    if (delegationCodes.includes(code)) return { type: 'delegation', code };
  }
  if (error instanceof AccessError) {
    const code = error.code;
    if (accessCodes.includes(code)) return { type: 'access', code };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const code = prismaCodes.find((allowed) => allowed === error.code);
    if (code === 'P2010' && error.meta?.code === '40001')
      return { type: 'prisma', code: 'serialization_conflict' };
    if (code === 'P2010' && error.meta?.code === '40P01')
      return { type: 'prisma', code: 'deadlock' };
    if (code) return { type: 'prisma', code };
  }
  if (error instanceof IncompleteGenerationError) {
    const code = error.reason;
    if (code === 'length' || code === 'tool_calls') return { type: 'incomplete_generation', code };
  }
  if (error instanceof GenerationUsageError) return { type: 'generation_usage', code: 'failed' };
  return undefined;
}

/** Routine telemetry contains only trusted codes, never provider text or diagnostics. */
export function generationDiagnostic(error: unknown): GenerationDiagnostic {
  let current = error;
  let diagnostic: GenerationDiagnostic = { type: 'unknown', code: 'unknown' };
  const seen = new Set<Error>();
  for (let depth = 0; depth <= 4 && current instanceof Error && !seen.has(current); depth++) {
    seen.add(current);
    const trusted = trustedDiagnostic(current);
    if (trusted && (trusted.type !== 'generation_usage' || diagnostic.type === 'unknown'))
      diagnostic = trusted;
    current = Object.getOwnPropertyDescriptor(current, 'cause')?.value;
  }
  return diagnostic;
}
