'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { PlayHttpError, playErrorMessage } from './api';
import { usePlayRequest } from './profile';

/** Keep the exact action and its caller pending until an uncertain result is reconciled. */
export function usePlayMutation<Schema extends z.ZodType>(
  schema: Schema,
  validateResult?: (value: z.infer<Schema>, body: unknown) => boolean
) {
  const playFetch = usePlayRequest();
  type Result = z.infer<Schema>;
  type Outcome =
    | { kind: 'OK'; value: Result }
    | { kind: 'REFUSED'; status: number; reason?: PlayHttpError['reason'] }
    | { kind: 'CANCELLED' };
  type Action = {
    path: string;
    body: unknown;
    controller: AbortController | null;
    inFlight: boolean;
    resolve: (value: Outcome) => void;
  };
  const action = useRef<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attempt = useCallback(
    async (current: Action) => {
      if (current.inFlight) return;
      current.inFlight = true;
      setBusy(true);
      setUncertain(false);
      setError(null);
      current.controller = new AbortController();
      try {
        const result = await playFetch(current.path, schema, {
          body: current.body,
          signal: current.controller.signal,
        });
        if (action.current !== current) return;
        if (validateResult && !validateResult(result, current.body))
          throw new PlayHttpError(
            0,
            'The server did not confirm this action. Retry keeps the exact request.'
          );
        action.current = null;
        setBusy(false);
        setPending(false);
        current.resolve({ kind: 'OK', value: result });
      } catch (caught) {
        if (action.current !== current) return;
        setBusy(false);
        setError(playErrorMessage(caught));
        if (
          !(caught instanceof PlayHttpError) ||
          caught.status === 0 ||
          caught.status === 429 ||
          caught.status >= 500
        ) {
          setUncertain(true);
          return;
        }
        action.current = null;
        setPending(false);
        current.resolve({ kind: 'REFUSED', status: caught.status, reason: caught.reason });
      } finally {
        current.inFlight = false;
      }
    },
    [schema, playFetch, validateResult]
  );

  const runOutcome = useCallback(
    (path: string, body: unknown): Promise<Outcome> => {
      if (action.current) return Promise.resolve({ kind: 'CANCELLED' });
      return new Promise((resolve) => {
        const current: Action = {
          path,
          body: structuredClone(body),
          controller: null,
          inFlight: false,
          resolve,
        };
        action.current = current;
        setPending(true);
        void attempt(current);
      });
    },
    [attempt]
  );

  const run = useCallback(
    async (path: string, body: unknown): Promise<Result | null> => {
      const outcome = await runOutcome(path, body);
      return outcome.kind === 'OK' ? outcome.value : null;
    },
    [runOutcome]
  );

  const retry = useCallback(async () => {
    const current = action.current;
    if (current && !current.inFlight) await attempt(current);
  }, [attempt]);

  useEffect(
    () => () => {
      const current = action.current;
      action.current = null;
      current?.controller?.abort();
      current?.resolve({ kind: 'CANCELLED' });
    },
    []
  );

  return { run, runOutcome, retry, busy, pending, uncertain, error };
}
