// Canonical CEFR level ordering and comparison helpers. Several modules need to
// rank or compare levels (placement re-take, exam blueprints, the learn hub);
// this is the single source of truth for that order.
import type { CefrLevel } from '@sotto/shared';

/** The CEFR ladder, lowest to highest. */
export const CEFR_ORDER: readonly CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/** Rank of a CEFR level (0 = A1 .. 5 = C2). */
export function cefrRank(level: CefrLevel): number {
  return CEFR_ORDER.indexOf(level);
}

/** The higher of two CEFR levels by the canonical order (ties return `a`). */
export function higherLevel(a: CefrLevel, b: CefrLevel): CefrLevel {
  return cefrRank(a) >= cefrRank(b) ? a : b;
}
