'use client';

import { useCallback, useRef, useState } from 'react';
import {
  playSafetyCompletedSchema,
  playSafetyPolicySchema,
  playSafetyStatusSchema,
  type PlaySafetyPolicy,
  type PlaySafetyStatus,
} from '@sotto/shared';
import { usePlayRequest } from '../client/profile';
import { usePlayPoll } from '../client/usePlayPoll';
import { usePlayMutation } from '../client/usePlayMutation';

export function usePlaySafetyStatus() {
  const request = usePlayRequest();
  const [policy, setPolicy] = useState<PlaySafetyPolicy | null>(null);
  const [status, setStatus] = useState<PlaySafetyStatus | null>(null);
  const readSequence = useRef(0);
  const load = useCallback(
    async (signal: AbortSignal) => {
      const sequence = ++readSequence.current;
      const [rules, current] = await Promise.all([
        request('/api/v1/play/policy', playSafetyPolicySchema, { signal }),
        request('/api/v1/play/safety', playSafetyStatusSchema, { signal }),
      ]);
      signal.throwIfAborted();
      if (readSequence.current !== sequence) return;
      setPolicy(rules);
      setStatus(current);
    },
    [request]
  );
  const polling = usePlayPoll(load, 5000);
  return {
    policy,
    status,
    load,
    error: polling.error,
    accepted: policy !== null && status?.acceptedVersion === policy.version,
    sharingAllowed:
      policy !== null && status?.acceptedVersion === policy.version && !status.sharingRestricted,
  };
}

function matchesAcknowledgment(value: { actionId: string; completed: true }, body: unknown) {
  return (
    body !== null &&
    typeof body === 'object' &&
    'actionId' in body &&
    value.actionId === body.actionId
  );
}

export function usePlaySafetyMutation() {
  return usePlayMutation(playSafetyCompletedSchema, matchesAcknowledgment);
}
