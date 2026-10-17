'use client';

import { useMemo, useEffect, useState, useReducer } from 'react';
import { STAGE_MESSAGES, resolveMessage } from '@sotto/shared';

const CYCLE_INTERVAL_MS = 9_000;
/** Number of ticks (~9s each) before switching from early→late pool */
const LATE_TICK_THRESHOLD = 13; // ~2 minutes

interface UseRotatingMessageOptions {
  status: string;
  topic?: string;
  isActive: boolean;
}

interface UseRotatingMessageResult {
  message: string | null;
  transitionKey: number;
}

export function useRotatingMessage({
  status,
  topic,
  isActive,
}: UseRotatingMessageOptions): UseRotatingMessageResult {
  // tick increments every cycle; forces re-render + new message derivation
  const [tick, bump] = useReducer((n: number) => n + 1, 0);
  const [stage, setStage] = useState({ status, startTick: tick });
  if (stage.status !== status) setStage({ status, startTick: tick });
  const ticksInStage = stage.status === status ? tick - stage.startTick : 0;

  // Cycle interval — only ticks when active
  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(bump, CYCLE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isActive]);

  // Derive message from tick + status (pure — no Date.now)
  const message = useMemo(() => {
    if (!isActive) return null;

    const pool = STAGE_MESSAGES[status];
    if (!pool) return null;

    const messages = ticksInStage >= LATE_TICK_THRESHOLD ? pool.late : pool.early;
    if (messages.length === 0) return null;

    const idx = ticksInStage % messages.length;
    return resolveMessage(messages[idx], topic);
  }, [isActive, status, topic, ticksInStage]);

  return { message, transitionKey: tick };
}
