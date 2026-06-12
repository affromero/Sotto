/** Small display formatters shared across the admin console (cost/usage views). */

export function fmtUSD(n: number): string {
  const digits = Math.abs(n) >= 100 ? 0 : 2;
  return `$${n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function fmtCompact(n: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

/** Whole-percent change from `prev` to `cur`; null when there's no prior baseline. */
export function pctChange(cur: number, prev: number): number | null {
  if (prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}
