import { ProcessRunner, ProcessExecutionError } from 'thesidedoor-core/runtime/process';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import type { AgentUsageProvider, AgentUsageWindow } from './types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const ERROR_CACHE_TTL_MS = 60 * 1000;
export const AUDIO_PROVIDER_CACHE_TTL_MS = 5 * 60 * 1000;

export function nowIso(): string {
  return new Date().toISOString();
}

export function buildProvider(input: Omit<AgentUsageProvider, 'refreshedAt'>): AgentUsageProvider {
  return {
    ...input,
    refreshedAt: nowIso(),
  };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getRecord(value: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const nested = value[key];
  return isRecord(nested) ? nested : null;
}

export function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function getNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function getBoolean(value: unknown): boolean {
  return value === true;
}

export function getEnvString(name: string): string | null {
  return process.env[name]?.trim() || null;
}

export function getIntegerEnv(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function percentFromUsage(used: number | null, limit: number | null): number {
  if (used === null || limit === null || limit <= 0) return 0;
  return clampPercent((used / limit) * 100);
}

export function percentFromFraction(value: number | null): number {
  if (value === null) return 0;
  return clampPercent(value * 100);
}

export function formatWholeNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

export function formatCreditLabel(value: number, suffix = 'credits left'): string {
  return `${formatWholeNumber(Math.max(0, Math.floor(value)))} ${suffix}`;
}

export function formatUsageDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const days = Math.floor(safeSeconds / 86_400);
  const hours = Math.floor((safeSeconds % 86_400) / 3_600);
  const minutes = Math.floor((safeSeconds % 3_600) / 60);

  if (days > 0) return `${days}d${String(hours).padStart(2, '0')}h`;
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m`;
}

export function formatResetAt(timestampSeconds: number | null): string | null {
  if (!timestampSeconds || timestampSeconds <= 0) return null;
  return new Date(timestampSeconds * 1000).toISOString();
}

export function resetInFromTimestamp(timestampSeconds: number | null, now: Date): string | null {
  if (!timestampSeconds || timestampSeconds <= 0) return null;
  return formatUsageDuration(timestampSeconds - now.getTime() / 1000);
}

export function friendlyReset(timestampSeconds: number | null): string | null {
  if (!timestampSeconds || timestampSeconds <= 0) return null;
  // ponytail: date only; the sidebar wraps this in parens and the duration
  // pushed the row past the panel width.
  const reset = new Date(timestampSeconds * 1000);
  return `${MONTHS[reset.getMonth()]} ${reset.getDate()}`;
}

export function resetInFromDate(date: Date | null, now: Date): string | null {
  if (!date) return null;
  return formatUsageDuration((date.getTime() - now.getTime()) / 1000);
}

export function windowLabel(seconds: number | null, fallback: string): string {
  if (seconds === 18_000) return '5h';
  if (seconds === 604_800) return 'Wk';
  if (seconds === 86_400) return '24h';
  if (seconds && seconds > 0 && seconds % 86_400 === 0) return `${seconds / 86_400}d`;
  if (seconds && seconds > 0 && seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  return fallback;
}

export function usageWindow(input: {
  label: string;
  usedPercent: number;
  resetIn: string | null;
  resetAt: string | null;
  limitWindowSeconds: number | null;
  valueLabel?: string | null;
  unbounded?: boolean;
}): AgentUsageWindow {
  const usedPercent = clampPercent(input.usedPercent);
  return {
    label: input.label,
    usedPercent,
    remainingPercent: clampPercent(100 - usedPercent),
    resetIn: input.resetIn,
    resetAt: input.resetAt,
    limitWindowSeconds: input.limitWindowSeconds,
    valueLabel: input.valueLabel ?? null,
    unbounded: input.unbounded ?? false,
  };
}

export function capitalizePlan(plan: string | null): string | null {
  if (!plan || plan === 'unknown' || plan === 'free') return null;
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

export function providerCacheKey(parts: Array<string | number | null>): string {
  return parts.map((part) => (part === null ? 'null' : String(part))).join(':');
}

export async function readJson(pathname: string, signal?: AbortSignal): Promise<unknown | null> {
  signal?.throwIfAborted();
  try {
    const text = await readFile(pathname, { encoding: 'utf8', signal });
    signal?.throwIfAborted();
    return JSON.parse(text) as unknown;
  } catch {
    signal?.throwIfAborted();
    return null;
  }
}

export async function execFileText(
  command: string,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal
): Promise<string | null> {
  signal?.throwIfAborted();
  try {
    const result = await new ProcessRunner().execute({
      command,
      args,
      environment: { ...process.env },
      timeoutMs,
      maxOutputBytes: 1024 * 1024,
      signal,
    });
    signal?.throwIfAborted();
    return result.stdout.trim() || null;
  } catch (error) {
    if (error instanceof ProcessExecutionError && error.code === 'cleanup_failed') throw error;
    signal?.throwIfAborted();
    return null;
  }
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  implementation: typeof fetch
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const signal = init.signal
      ? AbortSignal.any([init.signal, controller.signal])
      : controller.signal;
    signal.throwIfAborted();
    return await implementation(url, {
      ...init,
      signal,
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  implementation: typeof fetch
): Promise<{ response: Response; payload: unknown | null }> {
  const response = await fetchWithTimeout(url, init, timeoutMs, implementation);
  const text = await response.text();
  if (!text.trim()) return { response, payload: null };
  try {
    return { response, payload: JSON.parse(text) as unknown };
  } catch {
    return { response, payload: null };
  }
}
